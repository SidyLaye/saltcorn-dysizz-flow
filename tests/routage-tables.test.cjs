/* Règles d'envoi lues dans les tables de l'équipe, et table « qui reçoit aujourd'hui ». Saltcorn simulé. */
const assert = require("assert");
const Module = require("module");

const auj = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const jourIso = (() => { const n = new Date(auj + "T12:00:00Z").getUTCDay(); return n === 0 ? 7 : n; })();
const autreJour = (jourIso % 7) + 1;
const plus = (j) => new Date(Date.parse(auj + "T12:00:00Z") + j * 864e5);
const DONNEES = {
  equipe: [
    { id: 1, nom: "Alice", email: "alice@ex.org", role: "negociateur", actif: true, assistante: 3, temps: "plein", groupe: 7, crm: "500", agency_id: 405 },
    { id: 2, nom: "Bruno", email: "bruno@ex.org", role: "negociateur", actif: true, temps: "mi_temps", jours: String(autreJour), remplacant_hors_jours: 1 },
    { id: 3, nom: "Chloé", email: "chloe@ex.org", role: "assistante", actif: true },
    { id: 4, nom: "Denis", email: "denis@ex.org", role: "negociateur", actif: false, remplacant_inactif: 1 },
    { id: 5, nom: "Emma", email: "emma@ex.org", role: "negociateur", actif: true, temps: "plein", crm: "600" },
    { id: 6, nom: "Farid", email: "farid@ex.org", role: "negociateur", actif: true, temps: "plein" },
  ],
  absence: [
    { id: 1, personne: 5, debut: plus(-2), fin: plus(3), remplacant: 1, motif: "congés", actif: true },
    { id: 2, personne: 6, debut: plus(-10), fin: plus(-1), remplacant: 1, motif: "congés", actif: true },
  ],
  regle_envoi: [{ id: 1, nom: "groupe Albi", actif: true, negociateurs: "5,6", adresses_libres: "direction@ex.org" },
    /* si / sinon : mêmes personnes, la règle avec condition passe devant quand elle est remplie */
    { id: 6, nom: "Albi prestige", actif: true, negociateurs: "5,6", prix_au_dela: 1000000, couper_negociateur: true, adresses_libres: "prestige@ex.org" }],
  destinataire_custom: [
    { id: 1, email: "siege@ex.org", portee: "tous", actif: true },
    { id: 2, email: "compta@ex.org", libelle: "Compta Tarn", portee: "groupe", groupe: 7, actif: true },
    { id: 3, email: "direct@ex.org", libelle: "Direction", portee: "personnes", personnes: "6", actif: true },
    { id: 4, email: "coupe@ex.org", portee: "tous", actif: false },
    { id: 5, email: "region@ex.org", libelle: "Responsable région", portee: "personnes", personnes: "1,6", prix_au_dela: 700000, actif: true },
    { id: 6, email: "luxe@ex.org", portee: "tous", prix_au_dela: 2000000, actif: true },
    { id: 7, email: "fourchette@ex.org", portee: "personnes", personnes: "1", prix_au_dela: 500000, prix_jusqu_a: 700000, actif: true },
    { id: 8, email: "petits@ex.org", portee: "personnes", personnes: "1", prix_jusqu_a: 200000, actif: true },
    { id: 9, email: "landes@ex.org", portee: "tous", types_bien: "maisons, Propriété", codes_postaux: "40", actif: true },
    { id: 10, email: "lbc@ex.org", portee: "personnes", personnes: "1", portails: "leboncoin", natures: "estimation", actif: true },
  ],
  vue_routage: [],
};
const table = (name) => {
  const rows = DONNEES[name];
  if (!rows) return null;
  const champs = name === "vue_routage" ? ["id", "personne", "nom", "destinataires", "detail", "remplace", "maj_le"] : Object.keys(rows[0] || { id: 1 });
  return {
    name, getFields: () => champs.map((n) => ({ name: n })),
    getRows: async (w = {}) => rows.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v)),
    deleteRows: async () => { rows.length = 0; }, insertRow: async (r) => { rows.push(r); },
  };
};
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/models/table") return { findOne: ({ name }) => table(name) };
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, ...rest);
};
const { lireRoutage } = require("../src/lib/leads/routage-tables");
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);

(async () => {
  const conf = await lireRoutage();
  assert.strictEqual(conf.personnes.length, 6);
  assert.deepStrictEqual(conf.regles[0].cible, { negociateurs: ["5", "6"] }, "règle de groupe");
  assert.deepStrictEqual(conf.siege, ["siege@ex.org"]);
  const qui = async (id) => (await B("dzf_lead_destinataires").run({ negociateur: String(id), routage: "tables", tables: {} })).liste.map((d) => d.email);
  assert.deepStrictEqual((await qui(1)).sort(), ["alice@ex.org", "chloe@ex.org", "compta@ex.org", "siege@ex.org"], "titulaire, son assistante, le siège, la copie de son groupe");
  /* copies ciblées : seulement pour les personnes visées ; une copie coupée n'envoie rien */
  assert.ok(!(await qui(5)).includes("compta@ex.org"), "copie de groupe : pas pour une personne hors du groupe");
  assert.ok((await qui(6)).includes("direct@ex.org") && !(await qui(1)).includes("direct@ex.org"), "copie pour des personnes choisies");
  /* copie avec seuil de prix : seulement au-delà (strictement), seulement pour les personnes visées */
  const quiP = async (id, prix) => (await B("dzf_lead_destinataires").run({ negociateur: String(id), prix, routage: "tables", tables: {} })).liste.map((d) => d.email);
  assert.ok((await quiP(1, 750000)).includes("region@ex.org"), "seuil : bien au-delà de 700 000 €");
  assert.ok(!(await quiP(1, 700000)).includes("region@ex.org"), "seuil : 700 000 € pile n'est pas au-delà");
  assert.ok(!(await quiP(1, "")).includes("region@ex.org") && !(await qui(1)).includes("region@ex.org"), "seuil : prix inconnu → pas de copie");
  assert.ok(!(await quiP(5, 900000)).includes("region@ex.org"), "seuil : personne hors liste → pas de copie");
  assert.ok(!conf.siege.includes("luxe@ex.org") && (await quiP(5, 2500000)).includes("luxe@ex.org") && !(await quiP(5, 900000)).includes("luxe@ex.org"), "seuil sur une copie « tous » : pas dans le siège");
  assert.ok(!(await qui(1)).includes("coupe@ex.org"), "copie coupée");
  assert.ok((await qui(2)).includes("alice@ex.org") && !(await qui(2)).includes("bruno@ex.org"), "mi-temps : jour non travaillé → remplaçant");
  assert.ok((await qui(4)).includes("alice@ex.org") && !(await qui(4)).includes("denis@ex.org"), "parti : son remplaçant reçoit");
  const emma = await qui(5);
  assert.ok(emma.includes("alice@ex.org") && !emma.includes("emma@ex.org") && emma.includes("direction@ex.org"), "congés en cours : remplaçant, et adresse du groupe");
  const farid = await qui(6);
  assert.ok(farid.includes("farid@ex.org") && !farid.includes("alice@ex.org"), "congé terminé : retour à la normale sans rien toucher");

  const r = await B("dzf_lead_qui_recoit").run({ routage: "tables", tables: {}, table: "vue_routage", roles: "negociateur" }, {}, { Table: { findOne: ({ name }) => table(name) } });
  assert.deepStrictEqual([r.lignes, r.remplaces], [5, 3], "5 négociateurs, 3 remplacés aujourd'hui (mi-temps, parti, congés)");
  const e = DONNEES.vue_routage.find((x) => x.personne === 5);
  assert.ok(/congés/.test(e.detail) && /alice@ex\.org/.test(e.destinataires) && e.remplace === true, "l'explication est écrite");
  /* règles par agence et par groupe, priorité individuelle, groupe vide, relais vers une adresse libre */
  DONNEES.equipe.push({ id: 7, nom: "Gaël", email: "gael@ex.org", role: "negociateur", actif: true, temps: "plein", agence: 12, groupe: "Tarn" },
    { id: 8, nom: "Hana", email: "hana@ex.org", role: "negociateur", actif: true, temps: "plein", agence: 12, groupe: "Tarn", assistante: 3 },
    { id: 9, nom: "Ivan", email: "ivan@ex.org", role: "negociateur", actif: true, temps: "plein", groupe: "Lot" });
  DONNEES.regle_envoi.push({ id: 2, nom: "agence 12", actif: true, agence: 12, adresses_libres: "agence12@ex.org" },
    { id: 3, nom: "Hana seule", actif: true, negociateur: 8, assistante: "ne reçoit pas" },
    { id: 4, nom: "groupe vide", actif: true, groupe: "Aveyron", couper_negociateur: true },
    { id: 5, nom: "groupe Lot", actif: true, groupe: "Lot", adresses_libres: "lot@ex.org" });
  DONNEES.absence.push({ id: 3, personne: 9, debut: plus(-1), fin: plus(1), remplacant_adresse: "renfort@ex.org", motif: "congés", actif: true });
  const gael = await qui(7);
  assert.ok(gael.includes("gael@ex.org") && gael.includes("agence12@ex.org"), "règle d'agence appliquée à ses membres");
  const hana = await qui(8);
  assert.ok(hana.includes("hana@ex.org") && !hana.includes("chloe@ex.org") && !hana.includes("agence12@ex.org"), "la règle individuelle passe avant celle de l'agence");
  assert.ok((await qui(1)).includes("alice@ex.org"), "un groupe vide ne coupe pas tout le monde");
  const ivan = await qui(9);
  assert.ok(ivan.includes("renfort@ex.org") && !ivan.includes("ivan@ex.org") && ivan.includes("lot@ex.org"), "congés : relais vers une adresse libre, règle de groupe gardée");
  /* identifiants du CRM au lieu des numéros de ligne (le négociateur d'un bien est un id du CRM) */
  const c2 = await lireRoutage({}, "Europe/Paris", { id: "crm" });
  const alice = c2.personnes.find((p) => p.nom === "Alice");
  assert.strictEqual(alice.id, "500"); assert.strictEqual(alice.assistante_id, "e3", "sans id CRM : e<ligne>");
  assert.strictEqual(alice.agence_id, 405, "l'agence CRM de la personne suit (repli de l'agence d'un lead)");
  const T = require("../src/lib/leads/traiter");
  const ag = T.trouverAgence({ destinataire: "boite@ex.org" }, { negociateur_id: "500", agence_id: null }, { agences: [{ id: "405", nom: "Agence Albi", boites: ["boite@ex.org"] }, { id: "9", nom: "Centrale", boites: ["boite@ex.org"] }], routage: c2 });
  assert.strictEqual(ag.par, "négociateur du bien", "routage par tables : l'agence vient du négociateur");
  assert.deepStrictEqual(c2.regles[0].cible, { negociateurs: ["600", "e6"] });
  assert.strictEqual(c2.absences[0].personne_id, "600"); assert.strictEqual(c2.absences[0].remplacant.personne, "500");
  assert.ok(!("__equipe" in c2) && !("__equipe" in conf), "rien d'interne dans la configuration");
  const R = require("../src/lib/leads/routage");
  assert.deepStrictEqual(R.destinataires("500", new Date(), c2).liste.map((d) => d.email).sort().slice(0, 2), ["alice@ex.org", "chloe@ex.org"], "routage avec les ids du CRM");
  /* conditions générales : fourchette, plafond, type + code postal, portail + nature */
  const quiC = async (id, ctx) => (await B("dzf_lead_destinataires").run({ negociateur: String(id), routage: "tables", tables: {}, ...ctx })).liste.map((d) => d.email);
  assert.ok((await quiC(1, { prix: 600000 })).includes("fourchette@ex.org"), "fourchette : 600 000 € entre 500 000 et 700 000");
  assert.ok((await quiC(1, { prix: 700000 })).includes("fourchette@ex.org"), "fourchette : 700 000 € compris (jusqu'à)");
  assert.ok(!(await quiC(1, { prix: 500000 })).includes("fourchette@ex.org") && !(await quiC(1, { prix: 800000 })).includes("fourchette@ex.org"), "fourchette : bornes respectées");
  assert.ok((await quiC(1, { prix: 150000 })).includes("petits@ex.org") && !(await quiC(1, { prix: 250000 })).includes("petits@ex.org") && !(await quiC(1, {})).includes("petits@ex.org"), "plafond : seulement en dessous, prix inconnu exclu");
  assert.ok((await quiC(5, { type: "maison", code_postal: "40150" })).includes("landes@ex.org"), "type + code postal : maison des Landes");
  assert.ok((await quiC(5, { type: "propriete", code_postal: "40000" })).includes("landes@ex.org"), "type : accents et majuscules ignorés");
  assert.ok(!(await quiC(5, { type: "appartement", code_postal: "40150" })).includes("landes@ex.org") && !(await quiC(5, { type: "maison", code_postal: "64200" })).includes("landes@ex.org"), "type + code postal : les deux doivent être vrais");
  assert.ok((await quiC(1, { portail: "Leboncoin", nature: "estimation" })).includes("lbc@ex.org") && !(await quiC(1, { portail: "SeLoger", nature: "estimation" })).includes("lbc@ex.org") && !(await quiC(1, { portail: "Leboncoin", nature: "lead" })).includes("lbc@ex.org"), "portail + nature");
  /* si / sinon */
  const cher = await quiC(6, { prix: 1500000 });
  assert.ok(cher.includes("prestige@ex.org") && !cher.includes("farid@ex.org") && !cher.includes("direction@ex.org"), "si : condition remplie → règle prestige (négociateur coupé)");
  const normal = await quiC(6, { prix: 400000 });
  assert.ok(normal.includes("farid@ex.org") && normal.includes("direction@ex.org") && !normal.includes("prestige@ex.org"), "sinon : règle générale");
  const trace = (await B("dzf_lead_destinataires").run({ negociateur: "6", routage: "tables", tables: {}, prix: 400000 })).trace.join(" | ");
  assert.ok(/Albi prestige.*écartée/.test(trace), "la trace dit pourquoi la règle conditionnelle est écartée");
  /* priorité : une règle individuelle sans condition reste devant une règle de groupe avec condition */
  DONNEES.regle_envoi.push({ id: 7, nom: "Farid seul", actif: true, negociateur: 6, adresses_libres: "farid-perso@ex.org" });
  const prio = await quiC(6, { prix: 1500000 });
  assert.ok(prio.includes("farid-perso@ex.org") && !prio.includes("prestige@ex.org"), "priorité : la personne avant le groupe, même conditionnel");
  DONNEES.regle_envoi.pop();
  /* pipeline : le prix du bien du lead décide de la copie avec seuil */
  const etape = (prix) => T.etapeDestinataires({ motifs: [], alertes: [], extraction: {}, interne: {}, negociateur: "500", bien: prix ? { prix } : null }, { routage: c2 }).destinataires.liste.map((d) => d.email);
  assert.ok(etape(820000).includes("region@ex.org") && !etape(650000).includes("region@ex.org") && !etape(null).includes("region@ex.org"), "pipeline : copie région seulement au-delà du seuil");
  const etapeMail = T.etapeDestinataires({ motifs: [], alertes: [], extraction: { nature: "estimation", bien: { prix: 900000 } }, portail: "Leboncoin", interne: {}, negociateur: "500", bien: null }, { routage: c2 }).destinataires.liste.map((d) => d.email);
  assert.ok(etapeMail.includes("region@ex.org") && etapeMail.includes("lbc@ex.org"), "pipeline : prix du mail en repli, portail et nature du lead");
  console.log("routage lu dans les tables OK : ids du CRM, groupe, agence, priorité individuelle, relais par adresse, mi-temps, départ, congés, retour automatique, table « qui reçoit »");
})().catch((e) => { console.error(e); process.exit(1); });
