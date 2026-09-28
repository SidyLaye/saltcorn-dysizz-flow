/* Règles d'envoi lues dans les tables de l'équipe, et table « qui reçoit aujourd'hui ». Saltcorn simulé. */
const assert = require("assert");
const Module = require("module");

const auj = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const jourIso = (() => { const n = new Date(auj + "T12:00:00Z").getUTCDay(); return n === 0 ? 7 : n; })();
const autreJour = (jourIso % 7) + 1;
const plus = (j) => new Date(Date.parse(auj + "T12:00:00Z") + j * 864e5);
const DONNEES = {
  equipe: [
    { id: 1, nom: "Alice", email: "alice@ex.org", role: "negociateur", actif: true, assistante: 3, temps: "plein" },
    { id: 2, nom: "Bruno", email: "bruno@ex.org", role: "negociateur", actif: true, temps: "mi_temps", jours: String(autreJour), remplacant_hors_jours: 1 },
    { id: 3, nom: "Chloé", email: "chloe@ex.org", role: "assistante", actif: true },
    { id: 4, nom: "Denis", email: "denis@ex.org", role: "negociateur", actif: false, remplacant_inactif: 1 },
    { id: 5, nom: "Emma", email: "emma@ex.org", role: "negociateur", actif: true, temps: "plein" },
    { id: 6, nom: "Farid", email: "farid@ex.org", role: "negociateur", actif: true, temps: "plein" },
  ],
  absence: [
    { id: 1, personne: 5, debut: plus(-2), fin: plus(3), remplacant: 1, motif: "congés", actif: true },
    { id: 2, personne: 6, debut: plus(-10), fin: plus(-1), remplacant: 1, motif: "congés", actif: true },
  ],
  regle_envoi: [{ id: 1, nom: "groupe Albi", actif: true, negociateurs: "5,6", adresses_libres: "direction@ex.org" }],
  destinataire_custom: [{ id: 1, email: "siege@ex.org", portee: "tous", actif: true }],
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
  assert.deepStrictEqual((await qui(1)).sort(), ["alice@ex.org", "chloe@ex.org", "siege@ex.org"], "titulaire, son assistante, le siège");
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
  console.log("routage lu dans les tables OK : groupe, mi-temps, départ, congés, retour automatique, table « qui reçoit »");
})().catch((e) => { console.error(e); process.exit(1); });
