/* Rattrapage de leads précis : « simuler » ne traite qu'en lecture seule et n'envoie rien ; « appliquer » traite
   pour de vrai et n'envoie que les leads prêts, avec la clé de l'envoi normal. */
"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const LEADS = { 10: { id: 10, mail_id: 110, statut: "a_verifier" }, 11: { id: 11, mail_id: 111, statut: "a_verifier" } };
const RESULTAT = { 110: "pret", 111: "a_verifier", 120: "pret" };
const appels = [], envoyes = [], requetes = [];
const original = Module._load;
Module._load = function (n, parent, ...rest) {
  if (parent.filename.endsWith("rattrapage.js")) {
    if (n === "./schema") return { nom: (k) => "ld_" + k, prefixe: () => "ld_", tables: async () => ({ leads: { getRow: async ({ id }) => LEADS[id] || null } }) };
    if (n === "@saltcorn/data/db") return { getTenantSchema: () => "public", query: async (sql, args) => { requetes.push({ sql, args }); return { rows: /from "public"."ld_mails"/.test(sql) ? [{ id: 120 }] : [{ id: 10 }, { id: 11 }, { id: 77 }] }; } };
    if (n === "./dossier") return { traiterMail: async (mailId, o) => { appels.push({ mailId, simulation: o.simulation }); return { id: o.simulation ? null : mailId - 100, statut: RESULTAT[mailId], dossier: { statut: RESULTAT[mailId], motifs: RESULTAT[mailId] === "pret" ? [] : ["x"], bien: { id: 9, reference: "R9" }, negociateur: "20", destinataires: { liste: [{ email: "nego@ex.org" }] }, execution: { resultats: [{ op: "creerContact", fait: !o.simulation, mode: o.simulation ? "ombre" : "reel" }] } } }; } };
    if (n === "./envoi") return { messages: async (d, res) => ({ simuler: false, raison: "1 destinataire(s)", liste: d.destinataires.liste.map((x) => ({ cle: `ld_lead-${res.id}:${x.email}`, a: x.email })) }) };
    if (n === "../../envois") return { envoyer: async (l) => { envoyes.push(...l.map((m) => m.cle)); return { resume: `${l.length} envoyé(s)` }; } };
  }
  return original.call(this, n, parent, ...rest);
};
(async () => {
  const { rattraper, trouver } = require("../src/lib/leads/tables/rattrapage");
  /* recherche automatique : mails sans lead + leads à rattraper, « sauf » respecté */
  const c = await trouver({ depuis: "2026-10-01", sauf: "77" });
  assert.deepEqual(c, { mails: [120], leads: [10, 11] }, "trouvés, le 77 laissé de côté");
  const sql = requetes.map((r) => r.sql).join(" ");
  assert.ok(/not exists \(select 1 from "public"\."ld_leads" l where l\.mail_id = m\.id\)/.test(sql), "mails jamais traités");
  assert.ok(/non-automatise/.test(sql) && /ancien système/.test(sql) && /référence introuvable/.test(sql) && /lu par les règles générales/.test(sql) && /10 minutes/.test(sql), "critères des leads à rattraper");
  await assert.rejects(() => trouver({ depuis: "pas une date" }), /date/);
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
  /* mail jamais traité : traité, puis envoyé avec le numéro du lead créé */
  appels.length = 0; envoyes.length = 0;
  r = await rattraper("", "appliquer", { mails: [120] });
  assert.deepEqual(appels, [{ mailId: 120, simulation: false }]); assert.deepEqual(envoyes, ["ld_lead-20:nego@ex.org"], "lead créé par le retraitement, envoyé une fois");
  assert.equal(r.leads[0].statut_avant, "(jamais traité)"); assert.equal(r.prets, 1);
  /* rattrapage sans envoi : le CRM est écrit (traitement réel), aucun mail ne part */
  appels.length = 0; envoyes.length = 0;
  r = await rattraper("10", "appliquer", { envoyer: false });
  assert.deepEqual(appels, [{ mailId: 110, simulation: false }]); assert.equal(envoyes.length, 0, "sans envoi : aucun mail");
  assert.equal(r.leads[0].envoi, "non envoyé (rattrapage sans envoi)"); assert.equal(r.envoyes, 0);
  Module._load = original;
  console.log("rattrapage OK : simulation sans écriture ni envoi, application avec envoi unique des leads prêts");
})().catch((e) => { console.error(e); process.exitCode = 1; });
