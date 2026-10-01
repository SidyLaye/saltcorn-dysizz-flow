/* Leads immobiliers dans le Catalogue : chaque modèle n'utilise que des blocs qui existent, chaque étape
   suivante existe ; le mail envoyé aux négociateurs est complet et sans HTML injecté ; « envoyer une seule
   fois » ne renvoie jamais une clé déjà partie et abandonne après 5 échecs. Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
/* Saltcorn simulé : une table dzf_envois en mémoire et un serveur de mail qui peut échouer */
const LIGNES = []; let echouer = null; const partis = [];
const table = { getRow: async (w) => LIGNES.find((l) => Object.entries(w).every(([k, v]) => l[k] === v)) || null, getRows: async (w) => LIGNES.filter((l) => Object.entries(w).every(([k, v]) => l[k] === v)),
  insertRow: async (r) => { const id = LIGNES.length + 1; LIGNES.push({ ...r, id }); return id; }, updateRow: async (r, id) => Object.assign(LIGNES.find((l) => l.id === id), r) };
let REGLAGES = {}; const MAIL = { id: 5, objet: "Nouveau contact Logic-Immo RDZ123", expediteur: "Logic-Immo <contact@portail-exemple.fr>", destinataire: "rodez@agence-exemple.fr", date_envoi: "2026-09-29T08:00:00Z", corps_texte: "Nom : Paul <b>\nSon message : bonjour" };
Module._load = function (req, parent, ...rest) {
  if (req === "./conf" && parent && /envoi\.js$/.test(parent.filename)) return { reglages: async () => REGLAGES };
  if (req === "@saltcorn/data/models/table") return { findOne: () => ({ getRow: async (w) => (w.id === MAIL.id ? MAIL : null) }) };
  if (req === "@saltcorn/data/models/email") return { getMailTransport: async () => ({ sendMail: async (m) => { if (echouer) throw echouer; partis.push(m.to); return {}; } }) };
  if (req === "@saltcorn/data/db/state") return { getState: () => ({ getConfig: (k) => (k === "email_from" ? "leads@exemple.fr" : "") }) };
  if (req.startsWith("@saltcorn/")) return class {};
  if (req === "../store" || /[\\/]store$/.test(req)) return { ensureTables: async () => ({ envois: table }) };
  return orig.call(this, req, parent, ...rest);
};
const { BLOCKS } = require("../src/blocks");
const TEMPLATES = require("../src/templates");
const { contenu, messages } = require("../src/lib/leads/tables/envoi");
const { envoyer, reprendre } = require("../src/lib/envois");

(async () => {
  const noms = new Set(BLOCKS.map((b) => b.name));
  for (const key of ["leads_traitement", "leads_heure"]) {
    const t = TEMPLATES.find((x) => x.key === key);
    assert(t, "modèle " + key);
    const etapes = new Set(t.steps.map((s) => s.name));
    for (const s of [...t.steps, ...(t.installer || [])]) if (s.action_name !== "SetErrorHandler") assert(noms.has(s.action_name), `bloc absent : ${s.action_name}`);
    for (const s of t.steps) {
      for (const n of String(s.next_step || "").match(/"([a-z_]+)"|^[a-z_]+$/g) || []) assert(etapes.has(n.replace(/"/g, "")), `${key} : étape suivante inconnue ${n}`);
      if (s.action_name === "SetErrorHandler" && s.configuration.error_handling_step) assert(etapes.has(s.configuration.error_handling_step));
    }
  }
  assert(noms.has("dzf_table_structure") && noms.has("dzf_mail_une_fois") && noms.has("dzf_mail_reprendre"), "blocs génériques");

  const d = {
    portail: "Leboncoin", statut: "pret", agence: { nom: "Agence Exemple" },
    extraction: { nature: "lead", contact: { prenom: "Paul", nom: "<b>Test</b>", email: "paul@example.org", telephone: "+33600000000" }, bien: { reference: "30123" }, message: "Bonjour <script>alert(1)</script>" },
    bien: { id: 30123, reference: "30123", ville: "Cahors", prix: 245000, type: "maison" },
  };
  const m = contenu(d, { email: "martin@agence-exemple.fr", raison: "négociateur du bien" }, "https://exemple.fr/page/lead?id=7");
  assert.strictEqual(m.objet, "Nouveau lead Leboncoin — réf. 30123 — Paul <b>Test</b>");
  assert(!/<script>/.test(m.html) && /&lt;script&gt;/.test(m.html), "le message du prospect est échappé");
  for (const x of ["paul@example.org", "+33600000000", "réf. 30123", "Cahors", "Agence Exemple", "négociateur du bien", "page/lead?id=7"]) assert(m.html.includes(x), "contenu : " + x);

  /* format « origine » : le mail reçu tel quel, avec son objet d'origine, et la liste des destinataires */
  const dp = { ...d, mail_id: 5, destinataires: { liste: [{ email: "Rodez@agence-exemple.fr" }, { email: "assistante@agence-exemple.fr" }] } };
  REGLAGES = { format_envoi: "origine" };
  let r = await messages(dp, { id: 7 });
  assert.strictEqual(r.liste.length, 2); assert(r.simuler, "envois coupés par défaut : simulé");
  assert.strictEqual(r.liste[0].sujet, MAIL.objet, "objet d'origine");
  assert(r.liste[0].html.includes("Son message : bonjour") && r.liste[0].html.includes("rodez@agence-exemple.fr") && !/<b>\\n/.test(r.liste[0].html) && r.liste[0].html.includes("Paul &lt;b&gt;"), "mail d'origine, échappé, avec les destinataires");
  /* non automatisable : transféré tel quel à l'adresse réglée, jamais aux négociateurs */
  REGLAGES = { adresse_non_automatise: "nonauto@agence-exemple.fr, pas-une-adresse", envoi_mails: true };
  r = await messages({ ...dp, statut: "a_verifier", motifs: ["bien non trouvé : référence inconnue"] }, { id: 8 });
  assert.deepStrictEqual(r.liste.map((x) => x.a), ["nonauto@agence-exemple.fr"]); assert.strictEqual(r.simuler, false);
  assert.strictEqual(r.liste[0].sujet, MAIL.objet); assert(/non-automatise:/.test(r.liste[0].cle) && /bien non trouvé/.test(r.raison));
  REGLAGES.envoi_a_verifier = true;
  r = await messages({ ...dp, bien: null, statut: "a_verifier", motifs: ["bien non trouvé"] }, { id: 18 });
  assert.deepStrictEqual(r.liste.map((x) => x.a), ["nonauto@agence-exemple.fr"], "sans bien confirmé, jamais d'envoi au négociateur");
  REGLAGES.envoi_a_verifier = false;
  r = await messages({ ...dp, statut: "a_trier", destinataires: { liste: [] } }, { id: 9 }); assert.strictEqual(r.liste.length, 1, "à trier aussi, même sans destinataire");
  r = await messages({ ...dp, statut: "ignore" }, { id: 10 }); assert.strictEqual(r.liste.length, 0, "un non-lead ne part pas");
  r = await messages({ ...dp, statut: "a_trier", extraction: { ...dp.extraction, nature: "inconnu" } }, { id: 13 }); assert.strictEqual(r.liste.length, 0, "ni client ni bien : pas un lead, rien ne part");
  REGLAGES = {};
  r = await messages({ ...dp, statut: "a_verifier" }, { id: 11 }); assert.strictEqual(r.liste.length, 0, "sans adresse réglée : rien ne part");
  r = await messages(dp, { id: 12 }); assert(/Nouveau lead/.test(r.liste[0].sujet), "format par défaut : fiche du lead");

  /* une seule fois */
  const msg = { cle: "lead-1:martin@agence-exemple.fr", a: "martin@agence-exemple.fr", sujet: "s", html: "h" };
  let b = await envoyer([msg]); assert.strictEqual(b.envoyes, 1);
  b = await envoyer([msg]); assert.strictEqual(b.deja, 1); assert.deepStrictEqual(partis, ["martin@agence-exemple.fr"], "jamais deux fois");
  /* simulé : rien ne part */
  b = await envoyer([{ ...msg, cle: "lead-2:x@y.fr", a: "x@y.fr" }], { simuler: true }); assert.strictEqual(b.simules, 1); assert.strictEqual(partis.length, 1);
  /* échec temporaire puis reprise ; abandon après 5 essais ; erreur définitive = abandon tout de suite */
  echouer = new Error("connexion refusée");
  b = await envoyer([{ ...msg, cle: "lead-3:z@y.fr", a: "z@y.fr" }]); assert.strictEqual(b.echecs, 1);
  for (let i = 0; i < 3; i++) await reprendre();
  assert.strictEqual(LIGNES.find((l) => l.cle === "lead-3:z@y.fr").statut, "echec");
  await reprendre();
  assert.strictEqual(LIGNES.find((l) => l.cle === "lead-3:z@y.fr").statut, "abandonne", "abandon après 5 essais");
  echouer = Object.assign(new Error("550 boîte inconnue"), { responseCode: 550 });
  b = await envoyer([{ ...msg, cle: "lead-4:w@y.fr", a: "w@y.fr" }]); assert.strictEqual(b.abandonnes, 1, "erreur définitive");
  echouer = null;
  b = await envoyer([{ ...msg, cle: "lead-4:w@y.fr", a: "w@y.fr" }]); assert.strictEqual(b.deja, 1, "un envoi abandonné ne repart pas tout seul");
  console.log("leads (Catalogue) OK : modèles valides, mail complet et échappé, mail d'origine, transfert non automatisé, envoi une seule fois avec reprise et abandon");
})().catch((e) => { console.error(e); process.exit(1); });
