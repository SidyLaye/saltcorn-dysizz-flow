"use strict";
const assert = require("node:assert/strict");
const { creer } = require("../src/lib/leads/crm/immofacile");

(async () => {
  let form = null;
  const fake = async (url, options) => {
    if (url.includes("/client/token/site")) return {
      ok: true, status: 200, headers: new Map(),
      text: async () => JSON.stringify({ access_token: "test", expires_in: 3600 }),
    };
    if (url.endsWith("/customers/42/consent")) {
      form = options.body;
      return { ok: true, status: 204, headers: new Map(), text: async () => "" };
    }
    if (url.includes("/customers/42?include=")) return {
      ok: true, status: 200, headers: new Map(),
      text: async () => JSON.stringify({data:{id:42,consent:{reason:"Demande immobilière",proofs:[{file:"demande.eml"}]}}}),
    };
    throw Error("Appel inattendu");
  };
  const crm = creer({ site_id: "test", secret: async () => "dGVzdA==", fetch: fake });
  await crm.ajouterConsentement(42, { date: "2026-10-01T15:11:42.123Z", motif: "Demande immobilière",
    preuves: [{ nom: "demande.eml", type: "message/rfc822", base64: Buffer.from("mail").toString("base64") }] });
  assert.ok(form instanceof FormData);
  assert.equal(form.get("consent_date"), "2026-10-01T15:11:42+00:00");
  assert.equal(form.getAll("proofs[]").length, 1);
  assert.equal(form.get("reason"), "Demande immobilière");
  console.log("consentement : format API confirmé");
})().catch((e) => { console.error(e); process.exitCode = 1; });
