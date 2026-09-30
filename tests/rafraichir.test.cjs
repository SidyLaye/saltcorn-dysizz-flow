/* Mémoire de Saltcorn partagée entre processus : une table créée ailleurs est retrouvée en base,
   et tous les processus sont prévenus après la requête (pas seulement celui qui a créé). */
"use strict";
const assert = require("assert");
const Module = require("module");
const appels = [], base = new Set(["ld_mails"]), memoire = new Set();
const state = { refresh_tables: async (sans) => { appels.push(["tables", !!sans]); if (sans) for (const n of base) memoire.add(n); }, refresh_triggers: async (sans) => appels.push(["triggers", !!sans]) };
const faux = {
  "@saltcorn/data/db": { getTenantSchema: () => "public", runWithTenant: async (s, f) => f(), selectMaybeOne: async (t, w) => (base.has(w.name) ? { name: w.name } : null) },
  "@saltcorn/data/db/state": { getState: () => state },
  "@saltcorn/data/models/table": { findOne: ({ name }) => (memoire.has(name) ? { name } : null) },
};
const orig = Module._load;
Module._load = function (req, ...rest) { if (faux[req]) return faux[req]; return orig.call(this, req, ...rest); };
const { rafraichir, trouverTable } = require("../src/lib/rafraichir");
(async () => {
  assert.deepStrictEqual(await trouverTable("ld_mails"), { name: "ld_mails" }, "table créée par un autre processus : retrouvée en base");
  assert.strictEqual(await trouverTable("ld_rien"), null, "table vraiment absente");
  appels.length = 0;
  await rafraichir(["tables", "triggers"]);
  assert.deepStrictEqual(appels, [["tables", true], ["triggers", true]], "ce processus d'abord, sans attendre");
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepStrictEqual(appels.slice(2), [["tables", false], ["triggers", false]], "puis tous les processus sont prévenus, hors de la requête");
  console.log("mémoire partagée OK : table d'un autre processus retrouvée, tous les processus prévenus");
})().catch((e) => { console.error(e); process.exit(1); });
