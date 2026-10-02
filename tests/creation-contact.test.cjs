"use strict";
const assert = require("node:assert/strict");
const { creer } = require("../src/lib/leads/crm/immofacile");

const response = (status, data) => ({ ok: status >= 200 && status < 300, status,
  headers: new Map(), text: async () => data == null ? "" : JSON.stringify(data) });

(async () => {
  const calls = [];
  const fake = async (url, options) => {
    if (url.includes("/client/token/site")) return response(200, { access_token: "test", expires_in: 3600 });
    if (url.endsWith("/customers") && options.method === "POST") {
      const body = JSON.parse(options.body);
      calls.push({ op: "create", body });
      assert.equal(body.email, "new@example.org");
      assert.equal(body.check_duplicate, true);
      assert.equal(body.phone, undefined);
      assert.equal(body.mobile_phone, undefined);
      assert.equal(body.firstname, "Prénom non communiqué");
      assert.equal(body.lastname, "Nom non communiqué");
      return response(201, { data: { id: 101 } });
    }
    if (url.includes("/customers/101") && options.method === "PATCH") {
      calls.push({ op: "phone", body: JSON.parse(options.body) });
      return response(422, { error: { code: "VALIDATION_ERROR", details: [{ field: "mobile_phone", message: "number already used" }] } });
    }
    if (url.includes("/customers/101") && options.method === "GET")
      return response(200, { data: { id: 101, email: "new@example.org" } });
    throw Error("Appel inattendu");
  };
  const crm = creer({ site_id: "test", secret: async () => "dGVzdA==", fetch: fake });
  const result = await crm.creerContact({ email: "new@example.org", telephone: "+33612345678" });
  assert.equal(result.id, 101);
  assert.ok(result.non_pris.some((x) => x.includes("mobile_phone")));
  assert.deepEqual(calls.map((x) => x.op), ["create", "phone"]);
  console.log("création avec téléphone partagé : contact conservé");
})().catch((e) => { console.error(e); process.exitCode = 1; });
