/* Corrections du 09/11 (suite) : commune Properstar, commune de l'objet d'un mail direct, vrais doublons du CRM,
   modèle de lecture transmis au plugin, alerte de panne de l'IA. Données fictives. */
"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const orig = Module._load;
let appelPlugin = null;
Module._load = function (n, ...rest) {
  if (n === "@saltcorn/data/db/state") return { getState: () => ({ functions: { llm_generate: { run: async (p, o) => { appelPlugin = o; return { tool_calls: [{ input: { nature: "notification", confiance_nature: 0.9 } }] }; } } } }) };
  if (n.startsWith("@saltcorn/")) return {};
  return orig.call(this, n, ...rest);
};
const { extraire } = require("../src/lib/leads/extraire");
const RP = require("../src/lib/leads/rapprochement");
const IA = require("../src/lib/leads/ia");
const AL = require("../src/lib/leads/tables/alerte_ia");
const conf = { domaines_agence: ["agence-exemple.fr"], portails: [], routage: { personnes: [] } };
const lis = (expediteur, objet, texte) => extraire({ expediteur, objet, texte, destinataire: "contact@agence-exemple.fr" }, conf);

(async () => {
  /* Properstar, annonce sans identifiant : la commune est la ligne au-dessus de « Maison · … », approximative */
  const ps = lis("Properstar <x@reply.properstar.com>", "Nouveau message sur Properstar (#ABC123)", [
    "= Nouveau message de Jan Exemple =", "Bonjour, ce bien est-il toujours à vendre ?", "== Annonce désirée ==", "<https://dashboard.properstar.com/listings/1/publication/>",
    "Proche Figeac, maison en pierre avec vue panoramique et", "dépendance", "", "Prendeignes", "", "Maison · 6 Pièces · 3 Chambres · 1 Salles de bains · 90 m²", "", "EUR 85 000", "== Informations de contact =="].join("\n"));
  assert.equal(ps.bien.ville, "Prendeignes"); assert.equal(ps.bien.lieu_approche, true); assert.equal(ps.bien.prix, 85000); assert.equal(ps.bien.type, "maison");
  /* titre coupé, pas de commune : une fin de titre en minuscules n'est pas une commune */
  const ps2 = lis("Properstar <x@reply.properstar.com>", "Nouveau message sur Properstar (#ABC124)", ["= Nouveau message de Jan Exemple =", "Bonjour", "== Annonce désirée ==", "Belle maison avec", "dépendance", "Maison · 6 Pièces · 90 m²", "EUR 85 000", "=="].join("\n"));
  assert.equal(ps2.bien.ville, undefined);

  /* mail direct : la commune du titre d'annonce recopié dans l'objet, approximative ; jamais le nom de l'agence */
  const d = lis("Jean Exemple <jean.exemple@gmail.com>", "Immeuble à Villefranche-de-Rouergue, 66 500 €", "Bonjour, l'immeuble m'intéresse pour la location. Jean");
  assert.equal(d.bien.ville, "Villefranche-de-Rouergue"); assert.equal(d.bien.lieu_approche, true); assert.equal(d.bien.prix, 66500);
  assert.equal(lis("Jean Exemple <jean.exemple@gmail.com>", "Demande à SELECTION HABITAT", "Bonjour, votre maison m'intéresse, je souhaite la visiter.").bien.ville, undefined);
  assert.equal(lis("Jean Exemple <jean.exemple@gmail.com>", "Maison à rénover", "Bonjour, votre maison m'intéresse, je souhaite la visiter.").bien.ville, undefined);

  /* vrais doublons (annonce recréée) : le plus récent ; deux biens différents restent ambigus */
  const crm = (biens) => ({ bienParId: async () => null, biensParReference: async (r) => biens.filter((b) => b.reference === r), tousLesBiens: async () => biens });
  const lead = { bien: { reference: "1253_1253", prix: 240000, surface: 33, pieces: 1, ville: "Antibes" } };
  const vieux = { id: 61474567, reference: "1253_1253", prix: 245000, surface: 33, pieces: 1, ville: "Antibes", code_postal: "06600", statut: "ASupprimer" };
  const neuf = { ...vieux, id: 61699001, statut: "EnCours" };
  const r1 = await RP.rapprocher(lead, crm([vieux, neuf]));
  assert.equal(r1.bien && r1.bien.id, 61699001, "le plus récent des deux doublons");
  assert.ok(r1.alertes.some((a) => /doublon dans le CRM/.test(a) && /61474567 ASupprimer/.test(a)));
  const autre = { ...neuf, id: 61699002, surface: 80, pieces: 3 };
  const r2 = await RP.rapprocher(lead, crm([vieux, autre]));
  assert.equal(r2.bien && r2.bien.id, 61474567, "le bien qui contredit le mail est écarté, l'autre est seul");
  const r3 = await RP.rapprocher({ bien: { reference: "1253_1253" } }, crm([vieux, { ...vieux, id: 61699003, prix: 399000 }]));
  assert.equal(r3.bien, null, "prix différents entre les deux biens : pas un doublon");
  assert.match(r3.motif, /plusieurs biens possibles/);

  /* modèle de lecture des mails transmis au plugin ; sans réglage, celui du plugin */
  await IA.creer({ fournisseur: "saltcorn", modele: "gpt-5-mini" }).lire({ expediteur: "a@b.fr", objet: "x" }, "texte 1");
  assert.equal(appelPlugin.model, "gpt-5-mini");
  await IA.creer({ fournisseur: "saltcorn" }).lire({ expediteur: "a@b.fr", objet: "x" }, "texte 2");
  assert.equal(appelPlugin.model, undefined);

  /* alerte de panne : trois échecs de suite ; une réussite récente l'empêche */
  assert.equal(AL.enPanne([{ ok: false }, { ok: false }, { ok: false }]), true);
  assert.equal(AL.enPanne([{ ok: false }, { ok: true }, { ok: false }]), false);
  assert.equal(AL.enPanne([{ ok: false }, { ok: false }]), false);
  const v = AL.valeurs("panne", { erreur: "You have no credits remaining\nplus" });
  assert.equal(v.length, 2); assert.match(v[0], /no credits remaining plus/); assert.ok(!/\n/.test(v.join(" ")));
  assert.match(AL.valeurs("plafond", { plafond: 200 })[0], /plafond de 200/);
  console.log("corrections du 09/11 (suite) OK : Properstar, objet des mails directs, doublons, modèle de lecture, alerte de panne");
})().catch((e) => { console.error(e); process.exitCode = 1; });
