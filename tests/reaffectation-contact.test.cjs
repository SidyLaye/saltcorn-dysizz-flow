"use strict";
const assert = require("node:assert/strict");
const { etapeContact } = require("../src/lib/leads/traiter");
const { creer } = require("../src/lib/leads/crm/immofacile");
(async () => {
  for (const cas of ["autre", "identique", "autre_agence", "sans_bien"]) {
    const c = { id: 42, email: "client@example.test", prenom: "Alice", nom: "Martin",
      negociateur: cas === "autre" ? 10 : 20, agence: cas === "autre_agence" ? 30 : 40 };
    const d = { extraction: { contact: { email: c.email }, portail: "leboncoin", bien: {}, recherche: {} },
      bien: cas === "sans_bien" ? null : { id: 99, negociateur_id: 20, agence_id: 40 },
      fil: { messages_dossier: [] }, interne: {}, dossier: {}, actions: [], alertes: [], motifs: [] };
    await etapeContact(d, { contactsParEmail: async () => [c], contact: async () => c },
      { agences: [{ id: "40", nom: "Agence du bien", negociateur_defaut: 21 }] });
    const p = d.actions.find(a => a.op === "majContact");
    if (cas === "autre") assert.deepEqual(p.donnees, { negociateur: 20 });
    else if (cas === "autre_agence") assert.deepEqual(p.donnees, { agence: "40" });
    else assert.equal(p, undefined, "pas de réaffectation inutile ou sans bien");
  }
  for (const confirme of [true, false]) {
    let writes = 0;
    const crm = creer({ site_id: "reaffectation-" + confirme, secret: async () => "test", fetch: async (url, o) => {
      if (url.includes("/client/token/site")) return new Response(JSON.stringify({ access_token: "test" }));
      if (o.method === "PATCH") {
        writes++; assert.deepEqual(JSON.parse(o.body), { agency_id: 40, user_id: 20 });
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: { id: 42, user: { id: confirme ? 20 : 10 }, agency: { id: 40 } } }));
    } });
    if (confirme) assert.equal((await crm.majContact(42, { negociateur: 20, agence: 40 })).id, 42);
    else await assert.rejects(crm.majContact(42, { negociateur: 20, agence: 40 }), /non confirmée/);
    assert.equal(writes, 1);
  }
  console.log("Réaffectation : négociateur du bien, agence corrigée, absence de bien protégée, relecture obligatoire OK");
})().catch(e => { console.error(e); process.exitCode = 1; });
