"use strict";
const assert = require("node:assert/strict");
const { creer } = require("../src/lib/leads/crm/immofacile");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: "fictif", expires_in: 3600 });
const attente = (signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new Error("aborted"));
  signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
});
const config = (fetch) => ({ fetch, secret: async () => "fictif", site_id: "demo", delai_ms: 8, attendre: async () => {} });
(async () => {
  let n = 0;
  const authBloquee = creer(config(async (url, options) => { n++; return attente(options.signal); }));
  await assert.rejects(authBloquee.origines(), /aborted/);
  assert.equal(n, 4, "l'authentification expire et reprend un nombre borné de fois");

  n = 0;
  const corpsBloque = creer(config(async (url, options) => {
    if (url.endsWith("/client/token/site")) return token();
    n++;
    return { ok: true, status: 200, headers: new Headers(), text: () => attente(options.signal) };
  }));
  await assert.rejects(corpsBloque.origines(), /aborted/);
  assert.equal(n, 4, "le délai inclut la lecture du corps");

  n = 0;
  const lectureReprise = creer(config(async (url) => {
    if (url.endsWith("/client/token/site")) return token();
    return ++n < 3 ? json({}, 503) : json({ data: [{ id: 1 }] });
  }));
  assert.deepEqual(await lectureReprise.origines(), [{ id: 1 }]);
  assert.equal(n, 3);

  for (const cas of ["reseau", "corps", "serveur"]) {
    n = 0;
    const ecriture = creer(config(async (url, options) => {
      if (url.endsWith("/client/token/site")) return token();
      n++;
      if (cas === "reseau") throw new Error("connexion perdue après écriture");
      if (cas === "corps") return { ok: true, status: 200, text: () => attente(options.signal) };
      return json({ detail: "donnée personnelle à ne pas journaliser" }, 503);
    }));
    await assert.rejects(ecriture.ajouterConsentement(1, { motif: "Demande de contact", date: "2026-09-27", preuves: [] }), e => e.ambiguous === true && e.permanent === true && !e.message.includes("personnelle"));
    assert.equal(n, 1, "une écriture ambiguë n'est pas doublée : " + cas);
  }

  n = 0;
  const ombre = creer({ ...config(async () => { n++; throw new Error("ne doit pas être appelé"); }), lectureSeule: true });
  await assert.rejects(ombre.ajouterConsentement(1, { motif: "Test", date: "2026-09-27" }), e => e.ombre);
  assert.equal(n, 0, "mode ombre : aucun appel pour une écriture");
  console.log("Immofacile : délais auth/corps, reprises de lectures, absence de doublons d'écriture et mode ombre OK");
})().catch(e => { console.error(e); process.exitCode = 1; });
