"use strict";
const assert = require("node:assert/strict");
const Module = require("node:module");
const names = ["vue_lead", "vue_bien", "vue_agence", "vue_nego"];
let calls = [], fail = null;
const original = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === "@saltcorn/data/db") return { query: async () => ({ rows: names.map((name) => ({
    name, configuration: { table: name, cle: name === "vue_lead" ? "lead" : name === "vue_bien" ? "bien" : name === "vue_agence" ? "agence" : "nego", requete: "select 1" },
  })) }) };
  if (id.endsWith("/blocks/extras")) return [{ name: "dzf_table_lecture", run: async (p) => {
    calls.push(p.table);
    if (p.table === fail) throw new Error("échec simulé");
    assert.equal(p.supprimer, true);
    assert.equal(p.delai_s, 300);
    return { ecrites: 1 };
  } }];
  return original.call(this, id, parent, ...rest);
};

(async () => {
  try {
    const { etapesValides, rafraichirVues } = require("../src/lib/leads/tables/reprise_vues");
    assert.deepEqual(etapesValides(names.join(",")), names);
    assert.throws(() => etapesValides("vue_lead,vue_lead"));
    const api = { user: { role_id: 1 } };
    const a = await rafraichirVues({ workflow: "ambs_lecture", etapes: names.join(","), api });
    assert.deepEqual(calls, names);
    assert.equal(a.terminees, 4);
    assert.equal(a.erreur, null);
    calls = []; fail = "vue_bien";
    const b = await rafraichirVues({ workflow: "ambs_lecture", etapes: names.join(","), api });
    assert.deepEqual(calls, ["vue_lead", "vue_bien"]);
    assert.equal(b.terminees, 1);
    assert.match(b.erreur, /vue_bien/);
    console.log("Recalcul des vues : ordre, arrêt après échec, aucun envoi");
  } finally { Module._load = original; }
})().catch((e) => { console.error(e); process.exitCode = 1; });
