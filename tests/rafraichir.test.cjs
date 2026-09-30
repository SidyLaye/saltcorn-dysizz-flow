/* Mémoire de Saltcorn partagée entre processus : une table créée ailleurs est retrouvée en base,
   et tous les processus sont prévenus après la requête (pas seulement celui qui a créé). */
"use strict";
const assert = require("assert");
const Module = require("module");
const appels = [], base = new Set(["ld_mails"]), memoire = new Set(), pg = new Set(["ld_reglages", "ld_mails"]), sql = [];
const state = { refresh_tables: async (sans) => { appels.push(["tables", !!sans]); if (sans) for (const n of base) memoire.add(n); }, refresh_triggers: async (sans) => appels.push(["triggers", !!sans]) };
const faux = {
  "@saltcorn/data/db": { getTenantSchema: () => "public", runWithTenant: async (s, f) => f(), selectMaybeOne: async (t, w) => (base.has(w.name) ? { name: w.name } : null),
    query: async (q, v = []) => { sql.push(q); if (/^select 1/.test(q)) return { rows: pg.has(v[1]) ? [{}] : [] }; if (/^select table_name/.test(q)) return { rows: [] };
      const m = q.match(/rename to "(.+)"/); if (m) { pg.delete("ld_reglages"); pg.add(m[1]); } return { rows: [] }; } },
  "@saltcorn/data/db/state": { getState: () => state },
  "@saltcorn/data/models/table": { findOne: ({ name }) => (memoire.has(name) ? { name } : null) },
};
const orig = Module._load;
Module._load = function (req, ...rest) { if (faux[req]) return faux[req]; return orig.call(this, req, ...rest); };
const { rafraichir, trouverTable, libererNom } = require("../src/lib/rafraichir");
(async () => {
  assert.deepStrictEqual(await trouverTable("ld_mails"), { name: "ld_mails" }, "table créée par un autre processus : retrouvée en base");
  assert.strictEqual(await trouverTable("ld_rien"), null, "table vraiment absente");
  /* table Postgres inconnue de Saltcorn : renommée (jamais effacée) pour que la création passe */
  const note = await libererNom("ld_reglages");
  assert(/renommée « ld_reglages_ancienne_\d{14} »/.test(note), note);
  assert(!sql.some((q) => /drop|delete|truncate/i.test(q)), "rien n'est effacé");
  assert.strictEqual(await libererNom("ld_mails"), null, "table connue de Saltcorn : on n'y touche pas");
  assert.strictEqual(await libererNom("ld_rien"), null, "nom libre : rien à faire");
  appels.length = 0;
  await rafraichir(["tables", "triggers"]);
  assert.deepStrictEqual(appels, [["tables", true], ["triggers", true]], "ce processus d'abord, sans attendre");
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepStrictEqual(appels.slice(2), [["tables", false], ["triggers", false]], "puis tous les processus sont prévenus, hors de la requête");
  console.log("mémoire partagée OK : table d'un autre processus retrouvée, tous les processus prévenus");
})().catch((e) => { console.error(e); process.exit(1); });
