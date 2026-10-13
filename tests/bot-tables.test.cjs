/* Bot WhatsApp des leads, avec les tables : numéro connu, numéro d'essai, tour reçu deux fois, CRM écrit
   seulement si réglé, messages d'essai jamais envoyés aux équipes, fiche envoyée une seule fois et jamais
   après une désinscription. Saltcorn, le CRM et Meta sont simulés. Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
const M = require("../src/lib/leads/crm/memoire");
const C = require("../src/lib/leads/tables/conf");

const vrai = (l, w) => Object.entries(w).every(([k, v]) => (v && typeof v === "object" && v.in ? v.in.includes(l[k]) : l[k] === v));
const table = (L = []) => ({ L,
  getRow: async (w) => L.find((l) => vrai(l, w)) || null,
  getRows: async (w, o = {}) => { const r = L.filter((l) => vrai(l, w)).sort((a, b) => (a[o.orderBy] > b[o.orderBy] ? 1 : -1) * (o.orderDesc ? -1 : 1)); return o.limit ? r.slice(0, o.limit) : r; },
  insertRow: async (r) => { const id = L.length + 1; L.push({ ...r, id }); return id; } });
const T = { bot: table(), dossiers: table([{ id: 7, tel9: "611111111", bien_crm: "99", contact_crm: "4242", negociateur: "500", portail: "leboncoin", nom: "Marie Test", maj_le: 2 },
  { id: 8, tel9: "611111111", bien_crm: "98", negociateur: "500", nom: "Marie Test", maj_le: 1 }]),
  leads: table([{ id: 1, dossier_id: 7, dossier: JSON.stringify({ extraction: { contact: { prenom: "marie" } } }) }]) };
const CONF = { routage: { siege: ["siege@agence-exemple.fr"], personnes: [{ id: "500", nom: "Martin Durand", email: "martin@agence-exemple.fr", role: "negociateur" }] } };
const crm = M.creer({ biens: [{ id: 99, reference: "30123", prix: 245000, surface: 120, pieces: 5, type: "maison", ville: "Cahors", code_postal: "46000", negociateur_id: "500", adresse: "12 rue du Test" }] });
let BOT = {}, MODE = "reel"; const mails = []; const meta = [];
Module._load = function (req, parent, ...rest) {
  const de = (parent && parent.filename) || "";
  if (/tables[\\/]bot\.js$/.test(de)) {
    if (req === "./schema") return { tables: async () => T, prefixe: () => "ld_", definitions: () => [] };
    if (req === "./conf") return { ...C, charger: async () => ({ conf: CONF, crm: { type: "memoire", mode: MODE }, reglages: { envoi_mails: true } }), reglages: async () => ({ bot: JSON.stringify(BOT) }) };
    if (req === "./core") return { flowApi: () => ({ crmDepuisCoffre: () => crm }) };
    if (req === "../../envois") return { envoyer: async (m, o) => { mails.push(...m.map((x) => ({ ...x, simuler: o.simuler }))); return { resume: `${m.length} message(s)` }; } };
    if (req === "../../verrou") return { sous: async (k, fn) => fn() };
    if (req === "../../../garde") return { lireSecret: async (n) => (n === "JETON_WA" ? "jeton-fictif" : undefined) };
  }
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, parent, ...rest);
};
global.fetch = async (url, o) => { meta.push({ url, to: typeof o.body === "string" ? JSON.parse(o.body).to : null }); return { ok: true, json: async () => (/media$/.test(url) ? { id: "m1" } : { messages: [{ id: "wamid.1" }] }) }; };
const { repondre } = require("../src/lib/leads/tables/bot");
const sortie = (code, plus = {}) => ({ type: "sortie", noeud: "TB3", quand: "2026-10-13T10:00:00Z", donnees: { code, statut: "demande transmise", temperature: "HOT", dernier_message: "Je veux visiter", ...plus } });

(async () => {
  /* numéro connu : le dossier le plus récent, ou celui que le bot désigne s'il est bien à ce numéro */
  let c = await repondre("sh_contexte", { telephone: "+33 6 11 11 11 11" });
  assert.strictEqual(c.dossier_id, 7); assert.strictEqual(c.prenom, "Marie"); assert.strictEqual(c.bien_public.ville, "Cahors"); assert.strictEqual(c.negociateur.nom, "Martin Durand");
  assert.ok(!/rue du Test/.test(JSON.stringify(c)));
  assert.strictEqual((await repondre("contexte", { telephone: "33611111111", dossier_id: 8 })).dossier_id, 8);
  assert.strictEqual((await repondre("contexte", { telephone: "33622222222", dossier_id: 7 })).inconnu, true, "le dossier d'un autre numéro n'est jamais rendu");
  await assert.rejects(repondre("contexte", { telephone: "12" }), /invalide/);
  await assert.rejects(repondre("autre", {}), /inconnue/);

  /* par défaut : conversation rangée, CRM non écrit, messages simulés et jamais aux équipes */
  BOT = { couleurs: { HOT: 5 }, actions: { defaut: 222 }, adresses_essai: "essai@exemple.fr" };
  const tour = { telephone: "33611111111", event_id: "ev1", evenements: [{ type: "inbound", donnees: { texte: "Je veux visiter" } }, sortie("OUT-1")] };
  let r = await repondre("sh_evenement", tour);
  assert.strictEqual(r.crm, "non écrit"); assert.strictEqual(crm.ecritures.length, 0);
  assert.deepStrictEqual(mails.map((m) => [m.a, m.simuler]), [["essai@exemple.fr", true]]);
  assert.ok(mails[0].html.includes("martin@agence-exemple.fr") && mails[0].html.includes("Je veux visiter"), "l'essai dit qui aurait reçu, avec l'échange");
  assert.deepStrictEqual(await repondre("sh_evenement", tour), { ok: true, deja: true }, "tour reçu deux fois : rien n'est refait");
  assert.strictEqual(mails.length, 1);

  /* en service : CRM écrit, équipes prévenues */
  BOT = { ...BOT, notifications: "reel", ecritures_crm: true }; mails.length = 0;
  r = await repondre("evenement", { ...tour, event_id: "ev2" });
  assert.deepStrictEqual(crm.ecritures.map((e) => e.op), ["couleurContact", "ajouterAction"]); assert.strictEqual(crm.ecritures[0].id, "4242");
  assert.deepStrictEqual(mails.map((m) => [m.a, m.simuler]).sort(), [["martin@agence-exemple.fr", false], ["siege@agence-exemple.fr", false]]);
  /* application en mode ombre : le réglage du bot ne suffit pas à écrire */
  MODE = "ombre"; crm.ecritures.length = 0;
  assert.strictEqual((await repondre("evenement", { ...tour, event_id: "ev3" })).crm, "non écrit"); assert.strictEqual(crm.ecritures.length, 0); MODE = "reel";

  /* numéro d'essai : pas de dossier, bien réel seulement lu, messages aux adresses d'essai même en service */
  BOT = { ...BOT, numeros_essai: { 33699999999: { reference: "30123", prenom: "Sidy" } }, whatsapp: { phone_number_id: "123", variable_jeton: "JETON_WA" } }; mails.length = 0; crm.ecritures.length = 0;
  c = await repondre("contexte", { telephone: "33699999999" });
  assert.strictEqual(c.dossier_id, null); assert.strictEqual(c.prenom, "Sidy"); assert.strictEqual(c.bien_public.prix, 245000);
  await repondre("evenement", { telephone: "33699999999", event_id: "ev4", evenements: [sortie("OUT-2")] });
  assert.deepStrictEqual(mails.map((m) => m.a), ["essai@exemple.fr"]); assert.strictEqual(crm.ecritures.length, 0);

  /* fiche : une seule fois, au bon numéro ; jamais après une désinscription */
  r = await repondre("sh_pdf_fiche", { telephone: "33699999999" });
  assert.strictEqual(r.envoyee, true); assert.strictEqual(r.identifiant, "wamid.1"); assert.deepStrictEqual(meta.map((m) => m.to), [null, "33699999999"]);
  assert.deepStrictEqual(await repondre("fiche", { telephone: "33699999999" }), { deja_envoyee: true }); assert.strictEqual(meta.length, 2);
  assert.strictEqual((await repondre("contexte", { telephone: "33699999999" })).fiche_annonce_envoyee, true);
  await repondre("evenement", { telephone: "33611111111", event_id: "ev5", evenements: [sortie("OUT-6", { temperature: "" }), { type: "optout", donnees: { mot_cle: "STOP" } }] });
  assert.deepStrictEqual(await repondre("fiche", { telephone: "33611111111" }), { echec: true, raison: "désinscrit" });
  assert.strictEqual((await repondre("contexte", { telephone: "33611111111" })).optout, true);
  assert.strictEqual((await repondre("fiche", { telephone: "33622222222" })).echec, true);
  console.log("bot avec tables : OK");
})().catch((e) => { console.error(e); process.exit(1); });
