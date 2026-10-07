/* Réaffectation ciblée : simulation sans écriture, seulement les contacts encore dans l'agence erronée,
   agence prise sur le négociateur quand le bien n'en a pas, leads locaux alignés. Données fictives. */
"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const rows = [
  { id: 1, mail_id: 1, contact_crm: "50", bien_crm: "70", contact_email: "a@example.test", recu_le: "2026-10-02T06:00:00Z" },
  { id: 2, mail_id: 2, contact_crm: "51", bien_crm: "71", contact_email: "b@example.test", recu_le: "2026-10-02T07:00:00Z" },
  // négociateur lu dans le CRM inconnu de l'annuaire : on prend celui retenu sur le lead
  { id: 3, mail_id: 3, contact_crm: "52", bien_crm: "72", contact_email: "c@example.test", recu_le: "2026-10-02T08:00:00Z", negociateur: "900" },
];
const c = new Map([["50", { id: 50, email: "a@example.test", negociateur: 900, agence: 100 }],   // rangé à tort dans 100
                   ["51", { id: 51, email: "b@example.test", negociateur: 900, agence: 300 }],
                   ["52", { id: 52, email: "c@example.test", negociateur: 999, agence: 100 }]]); // déplacé à la main : on n'y touche pas
let writes = 0, saved = null; const updates = [];
const client = { bienParId: async (id) => ({ id, negociateur_id: id === "72" ? 999 : 900, agence_id: null }), contact: async (id) => ({ ...c.get(String(id)) }),
  majContact: async (id, p) => { writes++; Object.assign(c.get(String(id)), { agence: p.agence }); },
  suivis: async (id) => [{ bien: { 50: "70", 51: "71", 52: "72" }[id] }], lierBien: async () => {} };
const CONF = { agences: [{ id: "100", nom: "Agence Nord" }, { id: "200", nom: "Agence Sud" }], routage: { personnes: [{ id: "900", agence_id: "200" }] } };
const original = Module._load;
Module._load = function (n, parent, ...rest) {
  if (parent.filename.endsWith("reaffectation.js")) {
    if (n === "./schema") return { nom: () => "ld_leads", prefixe: () => "ld_", tables: async () => ({ leads: {} }) };
    if (n === "./conf") return { charger: async () => ({ conf: CONF, crm: { mode: "reel", type: "immofacile" } }) };
    if (n === "./dossier") return { cleVerrou: (_a, _m, _c, id) => "mail:" + id, versMoteur: (x) => x };
    if (n === "./core") return { flowApi: () => ({ crmDepuisCoffre: () => client, verrou: { sous: async (_k, fn) => fn() } }) };
    if (n === "../../../store") return { ensureTables: async () => ({ cache: { getRow: async () => saved, insertRow: async (r) => { saved = { ...r, id: 1 }; }, updateRow: async (r) => { saved = { ...r, id: 1 }; } } }) };
    if (n === "@saltcorn/data/models/table") return { findOne: () => ({ getRow: async ({ id }) => ({ id }) }) };
    if (n === "@saltcorn/data/db") return { getTenantSchema: () => "test", query: async (sql, args) => {
      if (sql.startsWith("update")) { updates.push(args); return { rowCount: 1 }; }
      if (sql.includes("count(*)")) return { rows: [{ n: 0 }] };
      if (sql.includes("order by recu_le")) return { rows: rows.filter((r) => r.contact_crm === args[0]).slice(-1) };
      return { rows };
    } };
  }
  return original.call(this, n, parent, ...rest);
};
const { reaffecter } = require("../src/lib/leads/tables/reaffectation");
(async () => {
  const sim = await reaffecter({ debut: "2026-10-01T00:00:00Z", simuler: true, agenceErronee: "100" });
  assert.equal(writes, 0, "simulation : aucune écriture CRM"); assert.equal(updates.length, 0, "simulation : aucun lead modifié");
  assert.equal(saved, null, "simulation : pas de point de reprise");
  assert.equal(sim.a_modifier, 2); assert.equal(sim.hors_cible, 1);
  assert.deepEqual(sim.resultats.find((x) => x.contact_id === "52").prevu, { agence: "200" }, "repli sur le négociateur du lead");
  assert.deepEqual(sim.annuaire, { personnes: 1, avec_agence: 1 });
  assert.deepEqual(sim.resultats.find((x) => x.contact_id === "50").prevu, { agence: "200" }, "agence du négociateur, sans toucher au négociateur");

  const r = await reaffecter({ debut: "2026-10-01T00:00:00Z", agenceErronee: "100" });
  assert.equal(writes, 2); assert.equal(c.get("50").agence, "200"); assert.equal(c.get("52").agence, "200"); assert.equal(c.get("51").agence, 300, "contact déplacé à la main laissé tel quel");
  assert.equal(r.confirmes, 2); assert.equal(r.leads_corriges, 2);
  assert.deepEqual(updates[0], ["Agence Sud", "50", "2026-10-01T00:00:00.000Z", "Agence Nord"]);
  console.log("Réaffectation ciblée : simulation sans écriture, agence visée seulement, négociateur en repli, leads alignés OK");
})().catch((e) => { console.error(e); process.exitCode = 1; });
