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
  /* recherche par photo : le cas réel 20645 (French Property, « Salles-Curan, 99 000 € », référence absente du CRM) :
     prix et ville concordent mais c'est trop peu pour un mail qui citait une référence ; la photo départage */
  const P = require("../src/lib/leads/photo");
  const fp = { bien: { reference: "2583", prix: 99000, ville: "Salles-Curan", type: "maison" } };
  const vrai = { id: 61558459, reference: "33210", prix: 99000, ville: "SALLES CURAN", code_postal: "12410", surface: 63, pieces: 3, type: "maison" };
  const autres = [{ id: 1, reference: "1", prix: 99500, ville: "RODEZ", code_postal: "12000", type: "maison" }, { id: 2, reference: "2", prix: 98000, ville: "ALBI", code_postal: "81000", type: "maison" }];
  const cat = crm([vrai, ...autres]);
  const sansPhoto = await RP.rapprocher(fp, cat);
  assert.equal(sansPhoto.bien, null, "sans photo : pas assez de preuves");
  const parPhoto = (m) => async (biens) => new Map(biens.map((b) => [String(b.id), m[b.id] ?? 60]));
  const avec = await RP.rapprocher(fp, cat, { comparerPhotos: parPhoto({ 61558459: 4, 1: 44, 2: 41 }) });
  assert.equal(avec.bien && avec.bien.id, 61558459); assert.match(avec.methode, /^criteres\+photo:/);
  assert.ok(avec.alertes.some((x) => /bien retrouvé par la photo de l'annonce : correspondance \d+ %/.test(x)));
  assert.equal((await RP.rapprocher(fp, cat, { comparerPhotos: parPhoto({ 61558459: 4, 1: 12 }) })).bien, null, "deux biens à la photo proche : on ne choisit pas");
  assert.equal((await RP.rapprocher(fp, cat, { comparerPhotos: parPhoto({ 61558459: 30, 1: 44 }) })).bien, null, "photo trop différente : rien");
  assert.equal((await RP.rapprocher(fp, cat, { comparerPhotos: async () => { throw new Error("réseau"); } })).bien, null, "erreur de photo : comme sans photo");
  const contre = await RP.rapprocher({ bien: { ...fp.bien, surface: 200 } }, cat, { comparerPhotos: parPhoto({ 61558459: 0 }) });
  assert.equal(contre.bien, null, "un bien contredit par le mail n'est jamais repris par la photo");
  /* images du mail : logos, pixels, http et cartes écartés */
  assert.deepEqual(P.imagesDuMail('<img src="https://img.leboncoin.fr/api/v1/a.jpg?rule=ad-th"><img src="http://em.green-acres.com/o.gif"><img src="https://x.fr/logo.png"><img src=\'https://cdn3.french-property.com/agency_1/2/3.jpg?height=326&amp;width=490\'>'),
    ["https://img.leboncoin.fr/api/v1/a.jpg?rule=ad-th", "https://cdn3.french-property.com/agency_1/2/3.jpg?height=326&width=490"]);
  /* adresses : jamais une adresse interne (mail piégé) */
  const dnsDe = (l) => async () => l.map((address) => ({ address }));
  assert.equal(await P.adresseSure("https://img.leboncoin.fr/a.jpg", dnsDe(["151.101.1.1"])), true);
  for (const [u, l] of [["https://piege.exemple.com/a", ["10.0.0.5"]], ["https://piege.exemple.com/a", ["151.101.1.1", "169.254.169.254"]], ["http://img.leboncoin.fr/a", ["151.101.1.1"]],
    ["https://127.0.0.1/a", ["127.0.0.1"]], ["https://img.leboncoin.fr:8080/a", ["151.101.1.1"]], ["https://a:b@img.leboncoin.fr/a", ["151.101.1.1"]], ["https://piege.exemple.com/a", ["fd12::1"]]])
    assert.equal(await P.adresseSure(u, dnsDe(l)), false, u + " " + l);
  assert.equal(await P.charger("https://piege.exemple.com/a", async () => { throw new Error("ne doit pas être appelé"); }, { resoudre: dnsDe(["192.168.1.2"]) }), null);
  /* écart des empreintes : 0 pour la même, 128 pour l'opposée */
  const h = { d: Array(64).fill(1), p: Array(64).fill(0) };
  assert.equal(P.ecart(h, h), 0); assert.equal(P.ecart(h, { d: Array(64).fill(0), p: Array(64).fill(1) }), 128);
  /* sans sharp : aucune comparaison, aucun appel au réseau */
  assert.equal((await P.distances(["https://x.fr/a.jpg"], [vrai], { photosDe: async () => ["https://y.fr/b.jpg"], empreinte: async () => null, charger: async () => Buffer.from("x") })).size, 0);
  console.log("corrections du 09/11 (suite) OK : Properstar, objet des mails directs, doublons, modèle de lecture, alerte de panne, recherche par photo");
})().catch((e) => { console.error(e); process.exitCode = 1; });
