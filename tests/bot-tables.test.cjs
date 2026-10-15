/* Bot WhatsApp des leads, avec les tables : numéro connu, numéro d'essai, tour reçu deux fois, CRM écrit
   seulement si réglé, messages d'essai jamais envoyés aux équipes, fiche envoyée une seule fois et jamais
   après une désinscription. Saltcorn, le CRM et Meta sont simulés. Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
const M = require("../src/lib/leads/crm/memoire");
const C = require("../src/lib/leads/tables/conf");

const vrai = (l, w) => Object.entries(w).every(([k, v]) => (v && typeof v === "object" && v.in ? v.in.includes(l[k]) : l[k] === v));
const table = (L = []) => ({ L,
  getRow: async (w) => L.find((l) => vrai(l, w)) || null,
  getRows: async (w, o = {}) => { const r = L.filter((l) => vrai(l, w)).sort((a, b) => (a[o.orderBy] > b[o.orderBy] ? 1 : -1) * (o.orderDesc ? -1 : 1)); return o.limit ? r.slice(0, o.limit) : r; },
  insertRow: async (r) => { const id = L.length ? Math.max(...L.map((l) => l.id)) + 1 : 1; L.push({ ...r, id }); return id; },
  updateRow: async (r, id) => { const l = L.find((x) => x.id === id); if (l) Object.assign(l, r); },
  deleteRows: async (w) => { for (let i = L.length - 1; i >= 0; i--) if (vrai(L[i], w)) L.splice(i, 1); } });
const T = { bot: table(), dossiers: table([{ id: 7, tel9: "611111111", bien_crm: "99", contact_crm: "4242", negociateur: "500", portail: "leboncoin", nom: "Marie Test", maj_le: 2 },
  { id: 8, tel9: "611111111", bien_crm: "98", negociateur: "500", nom: "Marie Test", maj_le: 1 }]),
  leads: table([{ id: 1, dossier_id: 7, dossier: JSON.stringify({ extraction: { contact: { prenom: "marie" } } }) }]),
  biens: table(), reglages: table([{ id: 1 }]) };
const CONF = { routage: { siege: ["siege@agence-exemple.fr"], personnes: [{ id: "500", nom: "Martin Durand", email: "martin@agence-exemple.fr", role: "negociateur" },
  { id: "501", nom: "Julie Autre", email: "julie.autre@agence-exemple.fr", role: "negociateur" }] } };
const crm = M.creer({ biens: [{ id: 99, reference: "30123", prix: 245000, surface: 120, pieces: 5, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "500", adresse: "12 rue du Test", photos: ["https://x.fr/1.jpg"] },
  { id: 97, reference: "30777", prix: 210000, surface: 110, pieces: 4, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "501", adresse: "3 rue Secrète", photos: ["https://x.fr/97.jpg"],
    annonce: { criteres: [{ id: 36, nom: "Surface terrain", valeur: 800, nature: "nombre" }, { id: 122, nom: "Adresse", valeur: "3 rue Secrète", nature: "texte" }], descriptions: [], pieces: [] } },
  { id: 96, reference: "30666", prix: 900000, type: "maison", ville: "Figeac", code_postal: "46100", negociateur_id: "501", photos: ["https://x.fr/96.jpg"] }] });
/* appels au CRM pour un bien, et pannes simulées */
let LECTURES = 0, PANNE = null, LENT = 0; const lireVrai = crm.bienEtPhotos, CRM_CHANGE = {};   // CRM_CHANGE[id] : champs changés dans le CRM, ou null = bien retiré
crm.bienEtPhotos = async (id, ...a) => { LECTURES++; if (LENT) await new Promise((r) => setTimeout(r, LENT)); if (PANNE) throw PANNE;
  if (CRM_CHANGE[id] === null || CRM_CHANGE[id] === 403) throw Object.assign(new Error("introuvable"), { http: CRM_CHANGE[id] === 403 ? 403 : 404 });
  if (CRM_CHANGE[id] && CRM_CHANGE[id].id) return { photos: [], ...CRM_CHANGE[id] };
  return { ...(await lireVrai(id, ...a)), ...(CRM_CHANGE[id] || {}) }; };
let BOT = {}, MODE = "reel"; const mails = []; const meta = [];
/* IA de l'application (cartes du carrousel), simulée ; journal des appels du jour */
let IA_SORTIE = null, APPELS_IA = 0, IA_ACTIF = false; const notesIA = [];
Module._load = function (req, parent, ...rest) {
  const de = (parent && parent.filename) || "";
  if (/tables[\\/]bot\.js$/.test(de)) {
    if (req === "./schema") return { tables: async () => T, prefixe: () => "ld_", definitions: () => [] };
    if (req === "./conf") return { ...C, charger: async () => ({ conf: CONF, crm: { type: "memoire", mode: MODE }, reglages: { envoi_mails: true, ia_actif: IA_ACTIF, ia_plafond_jour: 5 } }), reglages: async () => ({ bot: JSON.stringify(BOT) }) };
    if (req === "./core") return { flowApi: () => ({ crmDepuisCoffre: () => crm, iaDepuisCoffre: () => ({ generer: async () => { APPELS_IA++; return IA_SORTIE; } }) }) };
    if (req === "./gabarits") return { appelsDuJour: async () => notesIA.length, noter: async (a) => notesIA.push(a) };
    if (req === "../../envois") return { envoyer: async (m, o) => { mails.push(...m.map((x) => ({ ...x, simuler: o.simuler }))); return { resume: `${m.length} message(s)` }; } };
    if (req === "../../verrou") return { sous: async (k, fn) => fn() };
    if (req === "../../../garde") return { lireSecret: async (n) => (n === "JETON_WA" ? "jeton-fictif" : undefined) };
  }
  if (/tables[\\/]catalogue\.js$/.test(de)) {
    if (req === "./schema") return { tables: async () => T, prefixe: () => "ld_" };
    if (req === "./core") return { flowApi: () => ({ crmDepuisCoffre: () => crm, leads: { ADAPTATEURS: { memoire: M } } }) };
    if (req === "./conf") return { charger: async () => ({ conf: CONF, crm: { type: "memoire" } }) };
  }
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, parent, ...rest);
};
global.fetch = async (url, o) => { meta.push({ url, to: typeof o.body === "string" ? JSON.parse(o.body).to : null }); return { ok: true, json: async () => (/media$/.test(url) ? { id: "m1" } : { messages: [{ id: "wamid.1" }] }) }; };
const { repondre } = require("../src/lib/leads/tables/bot");
const sortie = (code, plus = {}) => ({ type: "sortie", noeud: "TB3", quand: "2026-10-13T10:00:00Z", donnees: { code, statut: "demande transmise", temperature: "HOT", dernier_message: "Je veux visiter", ...plus } });

(async () => {
  /* numéro connu : le dossier le plus récent, ou celui que le bot désigne s'il est bien à ce numéro */
  let c = await repondre("sh_contexte", { telephone: "+33 6 11 11 11 11" });
  assert.strictEqual(c.dossier_id, 7); assert.strictEqual(c.prenom, "Marie"); assert.strictEqual(c.bien_public.ville, "Cahors"); assert.strictEqual(c.negociateur.nom, "Martin Durand");
  assert.ok(!/rue du Test/.test(JSON.stringify(c)));
  assert.strictEqual((await repondre("contexte", { telephone: "33611111111", dossier_id: 8 })).dossier_id, 8);
  assert.strictEqual((await repondre("contexte", { telephone: "33622222222", dossier_id: 7 })).inconnu, true, "le dossier d'un autre numéro n'est jamais rendu");
  await assert.rejects(repondre("contexte", { telephone: "12" }), /invalide/);
  await assert.rejects(repondre("autre", {}), /inconnue/);

  /* par défaut : conversation rangée, CRM non écrit, messages simulés et jamais aux équipes */
  BOT = { couleurs: { HOT: 5 }, actions: { defaut: 222 }, adresses_essai: "essai@exemple.fr" };
  const tour = { telephone: "33611111111", event_id: "ev1", evenements: [{ type: "inbound", donnees: { texte: "Je veux visiter" } }, sortie("OUT-1")] };
  let r = await repondre("sh_evenement", tour);
  assert.strictEqual(r.crm, "non écrit"); assert.strictEqual(crm.ecritures.length, 0);
  assert.deepStrictEqual(mails.map((m) => [m.a, m.simuler]), [["essai@exemple.fr", true]]);
  assert.ok(mails[0].html.includes("martin@agence-exemple.fr") && mails[0].html.includes("Je veux visiter"), "l'essai dit qui aurait reçu, avec l'échange");
  assert.deepStrictEqual(await repondre("sh_evenement", tour), { ok: true, deja: true }, "tour reçu deux fois : rien n'est refait");
  assert.strictEqual(mails.length, 1);

  /* en service : CRM écrit, équipes prévenues */
  BOT = { ...BOT, notifications: "reel", ecritures_crm: true }; mails.length = 0;
  r = await repondre("evenement", { ...tour, event_id: "ev2" });
  assert.deepStrictEqual(crm.ecritures.map((e) => e.op), ["couleurContact", "ajouterAction"]); assert.strictEqual(crm.ecritures[0].id, "4242");
  assert.deepStrictEqual(mails.map((m) => [m.a, m.simuler]).sort(), [["martin@agence-exemple.fr", false], ["siege@agence-exemple.fr", false]]);
  /* application en mode ombre : le réglage du bot ne suffit pas à écrire */
  MODE = "ombre"; crm.ecritures.length = 0;
  assert.strictEqual((await repondre("evenement", { ...tour, event_id: "ev3" })).crm, "non écrit"); assert.strictEqual(crm.ecritures.length, 0); MODE = "reel";

  /* couleur dès que le délai est connu (sans sortie), une seule fois tant qu'elle ne change pas ; écritures limitées aux numéros listés */
  const BOT0 = BOT; BOT = { ...BOT, ecritures_crm: ["33688888888"], couleurs: { HOT: 5, WARM: 8 }, numeros_essai: { 33688888888: { reference: "30123", prenom: "Awa", contact_crm: "777" } } };
  const temp = (id, t) => repondre("evenement", { telephone: "33688888888", event_id: id, evenements: [{ type: "temperature", donnees: { temperature: t } }] });
  crm.ecritures.length = 0; await temp("ev3a", "HOT");
  assert.deepStrictEqual(crm.ecritures.map((e) => [e.op, e.id]), [["couleurContact", "777"]]);
  await temp("ev3b", "HOT"); assert.strictEqual(crm.ecritures.length, 1, "même couleur : pas réécrite quand le lead reprend");
  await temp("ev3c", "WARM"); assert.strictEqual(crm.ecritures.length, 2, "couleur changée : réécrite");
  assert.strictEqual((await repondre("evenement", { ...tour, event_id: "ev3d" })).crm, "non écrit", "numéro hors liste : CRM non écrit");
  BOT = BOT0;

  /* numéro d'essai : pas de dossier, bien réel seulement lu, messages aux adresses d'essai même en service */
  BOT = { ...BOT, numeros_essai: { 33699999999: { reference: "30123", prenom: "Awa" } }, whatsapp: { phone_number_id: "123", variable_jeton: "JETON_WA" } }; mails.length = 0; crm.ecritures.length = 0;
  c = await repondre("contexte", { telephone: "33699999999" });
  assert.strictEqual(c.dossier_id, null); assert.strictEqual(c.prenom, "Awa"); assert.strictEqual(c.bien_public.prix, 245000);
  await repondre("evenement", { telephone: "33699999999", event_id: "ev4", evenements: [sortie("OUT-2")] });
  assert.deepStrictEqual(mails.map((m) => m.a), ["essai@exemple.fr"]); assert.strictEqual(crm.ecritures.length, 0);

  /* fiche : une seule fois, au bon numéro ; jamais après une désinscription */
  r = await repondre("sh_pdf_fiche", { telephone: "33699999999" });
  assert.strictEqual(r.envoyee, true); assert.strictEqual(r.identifiant, "wamid.1"); assert.deepStrictEqual(meta.map((m) => m.to), [null, "33699999999"]);
  assert.deepStrictEqual(await repondre("fiche", { telephone: "33699999999" }), { deja_envoyee: true }); assert.strictEqual(meta.length, 2);
  assert.strictEqual((await repondre("contexte", { telephone: "33699999999" })).fiche_annonce_envoyee, true);
  await repondre("evenement", { telephone: "33611111111", event_id: "ev5", evenements: [sortie("OUT-6", { temperature: "" }), { type: "optout", donnees: { mot_cle: "STOP" } }] });
  assert.deepStrictEqual(await repondre("fiche", { telephone: "33611111111" }), { echec: true, raison: "désinscrit" });
  assert.strictEqual((await repondre("contexte", { telephone: "33611111111" })).optout, true);
  /* le désinscrit réécrit : l'équipe est prévenue une fois, pas à chaque message */
  mails.length = 0;
  for (const id of ["ev5a", "ev5b"]) await repondre("evenement", { telephone: "33611111111", event_id: id, evenements: [{ type: "message_apres_stop", donnees: { texte: "en fait si" } }] });
  const alertes = mails.filter((m) => /désinscrit a réécrit/.test(m.objet || m.sujet || m.html || ""));
  assert.ok(alertes.length > 0 && new Set(alertes.map((m) => m.a)).size === alertes.length, "une alerte par destinataire, une seule fois : " + JSON.stringify(alertes.map((m) => m.a)));
  assert.strictEqual((await repondre("fiche", { telephone: "33622222222" })).echec, true);

  /* cartes du carrousel (revue du 15/10, § 6.1) : rédigées par l'IA de l'application une fois par bien, gardées avec lui, rendues au bot */
  {
    const { preparerCartes } = require("../src/lib/leads/tables/bot");
    IA_SORTIE = { fr: { titre: "Maison de 5 pièces à Cahors", lignes: ["🏡 120 m² et 5 pièces pour toute la famille", "📍 Une maison à Cahors", "💶 245 000 € pour l'ensemble", "🏡 Une maison exceptionnelle"] },
      en: { titre: "House in Cahors", lignes: ["🏡 120 m² and 5 rooms"] } };
    IA_ACTIF = true; notesIA.length = 0;
    await repondre("contexte", { telephone: "33611111111", dossier_id: 7 });   // copie du bien 99 dans ld_biens ; préparation lancée en arrière-plan
    const bien = { ...(await require("../src/lib/leads/tables/catalogue").bienFrais(crm, 99, {})) };
    const c = await preparerCartes(bien, { ia_actif: true, ia_plafond_jour: 5 });
    assert.deepEqual(c.fr.lignes, ["🏡 120 m² et 5 pièces pour toute la famille", "📍 Une maison à Cahors", "💶 245 000 € pour l'ensemble"], "ligne au superlatif retirée");
    const ligne99 = T.biens.L.find((b) => b.crm_id === "99");
    assert.equal(JSON.parse(ligne99.cartes).fr.titre, "Maison de 5 pièces à Cahors", "cartes gardées avec le bien");
    const appels = APPELS_IA; await preparerCartes({ ...bien, cartes: JSON.parse(ligne99.cartes) }, { ia_actif: true, ia_plafond_jour: 5 });
    assert.equal(APPELS_IA, appels, "même annonce : l'IA n'est pas rappelée");
    assert.equal(await preparerCartes({ ...bien, prix: 1 }, { ia_actif: false }), null, "IA coupée dans les réglages : rien");
    notesIA.push(...Array(5).fill({ ok: true })); assert.equal(await preparerCartes({ ...bien, prix: 2 }, { ia_actif: true, ia_plafond_jour: 5 }), null, "plafond du jour atteint : rien"); notesIA.length = 0;
    ligne99.synchro_le = new Date();   // copie fraîche : le contexte la rend telle quelle
    const ctx = await repondre("contexte", { telephone: "33611111111", dossier_id: 7 });
    assert.deepEqual(ctx.bien_public.cartes, { fr: { titre: "Maison de 5 pièces à Cahors", lignes: c.fr.lignes } }, "le bot reçoit les cartes, sans empreinte ni refus");
    IA_ACTIF = false;
  }

  /* le bien passe par l'application : relu dans le CRM puis enregistré (ld_biens), une ligne par bien, photos comprises */
  const cat = require("../src/lib/leads/tables/catalogue");
  const ligne99 = () => T.biens.L.filter((b) => b.crm_id === "99");
  assert.strictEqual(ligne99().length, 1, "le bien lu est enregistré dans l'application"); assert.strictEqual(ligne99()[0].prix, 245000);
  BOT = { ...BOT, photos: "pr_p" }; ligne99()[0].synchro_le = new Date(0);
  c = await repondre("contexte", { telephone: "33611111111" }); assert.deepStrictEqual(c.bien_public.photos_publiques, ["https://x.fr/1.jpg"]);
  assert.deepStrictEqual(JSON.parse(ligne99()[0].photos), ["https://x.fr/1.jpg"]);
  /* frais (moins de 2 min) : aucun nouvel appel au CRM */
  LECTURES = 0; await repondre("contexte", { telephone: "33611111111" }); await repondre("contexte", { telephone: "33611111111" }); assert.strictEqual(LECTURES, 0);
  /* une donnée modifiée dans le CRM est reprise dès que la version enregistrée n'est plus fraîche */
  CRM_CHANGE[99] = { prix: 239000 }; ligne99()[0].synchro_le = new Date(Date.now() - 10 * 60000);
  c = await repondre("contexte", { telephone: "33611111111" }); assert.strictEqual(c.bien_public.prix, 239000); assert.strictEqual(ligne99()[0].prix, 239000);
  /* rafale : 20 appels en même temps sur un bien à relire = un seul appel au CRM, une seule ligne */
  ligne99()[0].synchro_le = new Date(0); LECTURES = 0; LENT = 30;
  const rafale = await Promise.all(Array.from({ length: 20 }, () => repondre("contexte", { telephone: "33611111111" })));
  assert.strictEqual(LECTURES, 1); assert.ok(rafale.every((x) => x.bien_public.prix === 239000)); assert.strictEqual(ligne99().length, 1); LENT = 0;
  /* CRM en panne ou trop lent : la version enregistrée est rendue (marquée périmée), le bot n'attend pas */
  ligne99()[0].synchro_le = new Date(0); PANNE = Object.assign(new Error("HTTP 503"), { http: 503 });
  assert.strictEqual((await repondre("contexte", { telephone: "33611111111" })).bien_public.prix, 239000); PANNE = null;
  ligne99()[0].synchro_le = new Date(0); LENT = 300; const t0 = Date.now();
  const lent = await cat.bienFrais(crm, 99, { budget_ms: 50 }); assert.ok(lent.perime && Date.now() - t0 < 250, "au-delà du délai : version enregistrée"); LENT = 0;
  await new Promise((r) => setTimeout(r, 350)); assert.ok(Date.now() - new Date(ligne99()[0].synchro_le).getTime() < 2000, "la relecture finit en arrière-plan");
  /* doublon laissé par deux processus : nettoyé à la relecture suivante */
  T.biens.L.push({ ...ligne99()[0], id: 999 }); ligne99()[0].synchro_le = new Date(0); await cat.bienFrais(crm, 99, {}); assert.strictEqual(ligne99().length, 1);
  /* bien retiré du CRM (404) : marqué supprimé, plus montré */
  CRM_CHANGE[77] = { id: 77, reference: "R77", prix: 100000, type: "maison", ville: "Figeac", negociateur_id: "500" };
  assert.strictEqual((await cat.bienFrais(crm, 77, {})).ville, "Figeac");
  CRM_CHANGE[77] = null; T.biens.L.find((b) => b.crm_id === "77").synchro_le = new Date(0);
  assert.strictEqual(await cat.bienFrais(crm, 77, {}), null); assert.strictEqual(T.biens.L.find((b) => b.crm_id === "77").supprime, true);
  /* Immofacile répond 403 (pas 404) pour un bien inexistant ou hors du site : même effet */
  CRM_CHANGE[78] = { id: 78, reference: "R78", prix: 90000, type: "maison", ville: "Rodez" }; await cat.bienFrais(crm, 78, {});
  CRM_CHANGE[78] = 403; T.biens.L.find((b) => b.crm_id === "78").synchro_le = new Date(0);
  assert.strictEqual(await cat.bienFrais(crm, 78, {}), null); assert.strictEqual(T.biens.L.find((b) => b.crm_id === "78").supprime, true);

  /* bien fictif (essai) : saisi dans l'application, jamais demandé au CRM, jamais marqué supprimé ; nom et mail du numéro d'essai */
  T.biens.L.push({ id: 500, crm_id: "AMBS-TEST-1", reference: "AMBS-TEST-1", fictif: true, supprime: false, type: "maison", pieces: 6, chambres: 4, surface: 180, ville: "Salles-la-Source", code_postal: "12330", prix: 285000, negociateur: "500", photos: JSON.stringify(["https://x.fr/f1.jpg", "https://x.fr/f2.jpg"]) });
  BOT = { ...BOT, numeros_essai: { 221700000001: { bien: "AMBS-TEST-1", prenom: "Awa", nom: "Awa Diop", email: "awa@exemple.fr", negociateur: "500" } } }; LECTURES = 0;
  c = await repondre("contexte", { telephone: "+221 70 000 00 01" });
  assert.strictEqual(c.bien_public.ville, "Salles-la-Source"); assert.deepStrictEqual(c.bien_public.photos_publiques, ["https://x.fr/f1.jpg", "https://x.fr/f2.jpg"]); assert.strictEqual(LECTURES, 0, "un bien fictif n'est jamais demandé au CRM");
  assert.strictEqual(c.negociateur.nom, "Martin Durand"); assert.strictEqual(c.prenom, "Awa");
  mails.length = 0; await repondre("evenement", { telephone: "221700000001", event_id: "ev6", evenements: [sortie("OUT-1")] });
  assert.ok(mails[0].sujet.includes("Awa Diop") && mails[0].html.includes("awa@exemple.fr") && mails[0].html.includes("Salles-la-Source"), "mail lead qualifié : nom, mail, bien fictif");
  /* essai_routage : les vrais destinataires calculés, filtrés par les adresses d'essai (ni siège ni personne d'autre) */
  BOT = { ...BOT, essai_routage: true, adresses_essai: ["martin@agence-exemple.fr", "awa@exemple.fr"] }; mails.length = 0;
  await repondre("evenement", { telephone: "221700000001", event_id: "ev7", evenements: [sortie("OUT-1")] });
  assert.deepStrictEqual(mails.map((m) => m.a), ["martin@agence-exemple.fr"], "le négociateur calculé reçoit, le siège non");
  BOT = { ...BOT, essai_routage: false };
  BOT = { ...BOT, numeros_essai: { 221700000001: { reference: "AMBS-TEST-1", prenom: "Awa" } } };
  assert.strictEqual((await repondre("contexte", { telephone: "221700000001" })).bien_public.prix, 285000, "bien fictif retrouvé par sa référence");
  /* rapprochement des mails : catalogue local ignoré tant qu'il n'y a pas eu de synchronisation complète ; biens fictifs jamais proposés */
  cat.oublier(); assert.deepStrictEqual(await cat.biensLocaux(), [], "catalogue partiel (rempli par le bot) : le rapprochement passe au CRM");
  T.reglages.L[0].catalogue_synchro_le = new Date(); cat.oublier();
  assert.ok(!(await cat.biensLocaux()).some((b) => b.id === "AMBS-TEST-1"), "un bien fictif n'est jamais proposé au rapprochement");
  assert.strictEqual((await (await cat.avecCatalogue(crm)).biensParReference("AMBS-TEST-1"))[0].id, "AMBS-TEST-1", "sauf par sa référence exacte");
  /* lead d'essai : projet et message fournis par le réglage, repris dans le contexte */
  BOT = { ...BOT, numeros_essai: { 221700000001: { bien: "AMBS-TEST-1", prenom: "Awa", projet: { budget_max: 300000, delai: "dans 2 mois", revente: false }, message: "Je souhaite visiter" } } };
  c = await repondre("contexte", { telephone: "221700000001" });
  assert.strictEqual(c.deja_connu.budget, 300000); assert.strictEqual(c.deja_connu.delai, "dans 2 mois"); assert.strictEqual(c.deja_connu.bien_a_vendre, false); assert.strictEqual(c.demande.message, "Je souhaite visiter");
  /* « avez-vous d'autres biens ? » : biens en vente du même secteur, sans le bien de départ, champs publics seulement ;
     visite demandée sur l'un d'eux : le négociateur du bien d'origine ET celui du nouveau bien sont prévenus */
  BOT = { ...BOT, numeros_essai: {}, notifications: "reel", essai_routage: false };
  const autres = await repondre("sh_biens", { telephone: "33611111111" });
  assert.deepStrictEqual(autres.biens.map((b) => b.id), [97], "même code postal, sans le bien du dossier");
  assert.strictEqual(autres.biens[0].bien_public.details["Surface terrain"], "800 m²"); assert.ok(!/Secrète/.test(JSON.stringify(autres)), "jamais l'adresse");
  assert.deepStrictEqual(autres.biens[0].bien_public.photos_publiques, ["https://x.fr/97.jpg"]); assert.strictEqual(autres.biens[0].negociateur.nom, "Julie Autre");
  assert.strictEqual((await repondre("biens", { telephone: "33611111111", criteres: { lieu: "Figeac", prix_max: 1000000 } })).biens[0].id, 96, "critères du prospect");
  /* autres biens : les cartes déjà rédigées pour un bien sont rendues avec lui */
  await new Promise((r) => setTimeout(r, 20));   // copies en arrière-plan
  const l97 = T.biens.L.find((b) => b.crm_id === "97");
  l97.cartes = JSON.stringify({ empreinte: "x", fr: { titre: "Maison avec terrain à Cahors", lignes: ["🌳 800 m² de terrain", "🏡 110 m² et 4 pièces", "💶 210 000 €"] } });
  const avecCartes = await repondre("sh_biens", { telephone: "33611111111" });
  assert.deepEqual(avecCartes.biens[0].bien_public.cartes.fr.titre, "Maison avec terrain à Cahors");
  await new Promise((ok) => setTimeout(ok, 50));   // la copie se fait en arrière-plan
  assert.ok(T.biens.L.some((b) => b.crm_id === "97" && b.photos), "copie gardée pour la fiche et la visite");
  mails.length = 0;
  await repondre("evenement", { telephone: "33611111111", event_id: "ev8", evenements: [sortie("OUT-1", { autre_bien_id: 97 })] });
  assert.deepStrictEqual([...new Set(mails.map((m) => m.a))].sort(), ["julie.autre@agence-exemple.fr", "martin@agence-exemple.fr", "siege@agence-exemple.fr"]);
  assert.ok(mails[0].html.includes("Bien demandé") && mails[0].html.includes("réf. 30777") && mails[0].html.includes("Bien de l&#39;annonce d&#39;origine") && mails[0].html.includes("réf. 30123"));
  console.log("bot avec tables : OK");
})().catch((e) => { console.error(e); process.exit(1); });
