"use strict";
const assert = require("node:assert/strict");
const { resoudreContact } = require("../src/lib/leads/contact");
const { etapeContact } = require("../src/lib/leads/traiter");
const { creer } = require("../src/lib/leads/crm/immofacile");

(async () => {
  const panne = { contactsParEmail: async () => { throw Error("délai dépassé"); }, contactsParTelephone: async () => { throw Error("appel inattendu"); } };
  const rc = await resoudreContact({ email: "a@example.org", telephone: "+33612345678" }, panne);
  assert.equal(rc.action, "impossible");
  assert.equal(rc.par, "recherche_email");

  const d = {
    extraction: { contact: { email: "a@example.org" }, portail: "portail", bien: {}, nature: "lead" },
    bien: { id: 10, reference: "R10", agence_id: 1, negociateur_id: 2 },
    interne: { dos: { contact_id: 42 } }, fil: { messages_dossier: [] },
    alertes: [], motifs: [], actions: [],
  };
  const avecDossier = { ...panne, contact: async () => ({ id: 42, email: "a@example.org" }) };
  const sorti = await etapeContact(d, avecDossier, { actions: { contact: true } });
  assert.equal(sorti.contact.action, "impossible");
  assert.ok(sorti.motifs.some((x) => x.includes("recherche du contact CRM indisponible")));
  assert.ok(!sorti.actions.some((x) => x.op === "creerContact"));

  const dossierIllisible = {
    contactsParEmail: async () => [],
    contact: async () => { throw Error("fiche indisponible"); },
  };
  const d2 = { ...d, contact: null, interne: { dos: { contact_id: 42 } }, motifs: [], alertes: [], actions: [] };
  const sortie2 = await etapeContact(d2, dossierIllisible, { actions: { contact: true } });
  assert.equal(sortie2.contact.par, "recherche_dossier");
  assert.ok(!sortie2.actions.some((x) => x.op === "creerContact"));

  const requetes = [];
  const fake = async (url, options) => {
    requetes.push({ url, method: options.method });
    const body = url.includes("/client/token/site") ? { access_token: "essai", expires_in: 3600 }
      : url.endsWith("/discovery") ? { data: { agencies: [{ id: 7, name: "Agence" }] } }
      : { data: { unexpected: true } };
    return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) };
  };
  const crm = creer({ site_id: "test", secret: async () => "dGVzdA==", fetch: fake, attendre: async () => {} });
  assert.equal((await crm.tester()).agences[0].id, 7);
  await assert.rejects(crm.contactsParEmail("a@example.org"), /liste de contacts absente/);
  assert.ok(!requetes.some((x) => x.method === "POST" && x.url.endsWith("/customers")));
  console.log("sécurité contact et discovery OK");
})().catch((e) => { console.error(e); process.exitCode = 1; });
