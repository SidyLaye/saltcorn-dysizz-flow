/* Rattrapage de leads précis : « simuler » ne traite qu'en lecture seule et n'envoie rien ; « appliquer » traite
   pour de vrai et n'envoie que les leads prêts, avec la clé de l'envoi normal. */
"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const LEADS = { 10: { id: 10, mail_id: 110, statut: "a_verifier" }, 11: { id: 11, mail_id: 111, statut: "a_verifier" } };
const RESULTAT = { 110: "pret", 111: "a_verifier" };
const appels = [], envoyes = [];
const original = Module._load;
Module._load = function (n, parent, ...rest) {
  if (parent.filename.endsWith("rattrapage.js")) {
    if (n === "./schema") return { tables: async () => ({ leads: { getRow: async ({ id }) => LEADS[id] || null } }) };
    if (n === "./dossier") return { traiterMail: async (mailId, o) => { appels.push({ mailId, simulation: o.simulation }); return { id: o.simulation ? null : mailId - 100, statut: RESULTAT[mailId], dossier: { statut: RESULTAT[mailId], motifs: RESULTAT[mailId] === "pret" ? [] : ["x"], bien: { id: 9, reference: "R9" }, negociateur: "20", destinataires: { liste: [{ email: "nego@ex.org" }] }, execution: { resultats: [{ op: "creerContact", fait: !o.simulation, mode: o.simulation ? "ombre" : "reel" }] } } }; } };
    if (n === "./envoi") return { messages: async (d, res) => ({ simuler: false, raison: "1 destinataire(s)", liste: d.destinataires.liste.map((x) => ({ cle: `ld_lead-${res.id}:${x.email}`, a: x.email })) }) };
    if (n === "../../envois") return { envoyer: async (l) => { envoyes.push(...l.map((m) => m.cle)); return { resume: `${l.length} envoyé(s)` }; } };
  }
  return original.call(this, n, parent, ...rest);
};
(async () => {
  const { rattraper } = require("../src/lib/leads/tables/rattrapage");
  let r = await rattraper("10, 11, 999", "simuler");
  assert.deepEqual(appels.map((a) => a.simulation), [true, true], "simulation : traitement en lecture seule");
  assert.equal(envoyes.length, 0, "simulation : rien envoyé");
  assert.equal(r.leads[0].envoi, "serait envoyé"); assert.equal(r.leads[1].envoi, "ne serait pas envoyé");
  assert.equal(r.erreurs.length, 1, "lead inconnu signalé");
  appels.length = 0;
  r = await rattraper("10,11", "appliquer");
  assert.deepEqual(appels.map((a) => a.simulation), [false, false], "appliquer : traitement réel");
  assert.deepEqual(envoyes, ["ld_lead-10:nego@ex.org"], "seul le lead devenu prêt part, avec la clé de l'envoi normal");
  assert.equal(r.encore_bloques, 1); assert.equal(r.envoyes, 1);
  Module._load = original;
  console.log("rattrapage OK : simulation sans écriture ni envoi, application avec envoi unique des leads prêts");
})().catch((e) => { console.error(e); process.exitCode = 1; });
