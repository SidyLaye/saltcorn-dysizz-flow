"use strict";
/* Cartes du carrousel du bien : un texte par carte (demande de Sidy du 16/10), rédigé par l'IA de Botpress (le bot, après avoir répondu
   au lead : jamais pendant qu'il attend) à partir de la consigne et des photos préparées ici (travail). L'IA voit chaque photo et met en
   valeur ce qu'elle montre, en 2 lignes avec émojis, à partir des faits de l'annonce. L'application contrôle chaque texte (recevoirCartes) :
   un texte fautif est retiré ; une langue avec moins de 3 textes valides n'est pas rendue (le bot reprend ses lignes de secours).
   Les données envoyées à l'IA sont celles que le bot a le droit de dire (bienPublic + annonce() : rien de la slide 07, aucun montant
   autre que le prix, aucune distance sans unité). */
const crypto = require("crypto");
const B = require("./bot");
const { cle } = require("./texte");

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["fr", "en"],
  properties: Object.fromEntries(["fr", "en"].map((l) => [l, { type: "object", additionalProperties: false, required: ["titre", "cartes"],
    properties: { titre: { type: "string" }, cartes: { type: "array", items: { type: "object", additionalProperties: false, required: ["photo", "texte"],
      properties: { photo: { type: "integer" }, texte: { type: "string" } } } } } }])),
};

const donneesPourCartes = (bien) => {
  const pub = B.bienPublic(bien) || {}, an = B.annonce(bien && bien.annonce) || {};
  return { ...pub, ...(an.details ? { caracteristiques: an.details } : {}), ...(an.titre_annonce ? { titre_annonce: an.titre_annonce } : {}),
    ...(an.description_annonce ? { description: an.description_annonce } : {}), ...(an.pieces_detail ? { pieces: an.pieces_detail } : {}) };
};

/* VERSION : à augmenter quand les consignes ou les contrôles changent, pour que les cartes déjà rédigées soient refaites */
const VERSION = 3;
const empreinte = (bien) => crypto.createHash("sha1").update(JSON.stringify([VERSION, donneesPourCartes(bien), (bien && bien.photos) || []])).digest("hex");

/* photos rédigées : 9 au plus, la dernière photo est gardée pour la carte du référent (ajoutée par le bot) */
const photosACommenter = (photos) => (Array.isArray(photos) ? photos : []).filter((u) => /^https:\/\//.test(String(u))).slice(0, 10).slice(0, -1).slice(0, 9);

/* La consigne et les photos, dans un seul message : « Photo 1 », image, « Photo 2 », image… */
const consignesPhotos = (donnees, n) => `Tu écris le texte de chaque carte d'un carrousel WhatsApp qui présente un bien immobilier à un acheteur qui a déjà répondu à son annonce.
Agence : Sélection Habitat - Agence Hamilton (maisons de caractère, une expérience immobilière à hautes valeurs humaines).
Chaque carte montre une photo du bien ; sous la photo, ton texte doit donner envie d'acheter en mettant en valeur ce que montre CETTE photo.
L'acheteur achète une vie (le calme, la place, la pierre, la vue, recevoir), pas une fiche technique.

Pour chaque photo, de Photo 1 à Photo ${n}, écris un texte en français ET en anglais :
- regarde la photo et mets en valeur l'attribut qu'elle montre (façade, pièce, cuisine, chambre, jardin, terrain, vue, piscine, dépendance, matériaux…),
  relié à un fait des DONNÉES quand il y en a un (surface, nombre de chambres, terrain, chauffage, construction, vue…) ;
- 2 lignes, séparées par un saut de ligne : la 1re ligne met l'attribut en valeur, la 2e dit ce qu'il permet de vivre, comme une possibilité
  (« de quoi recevoir », « pour les soirées d'hiver ») ;
- chaque ligne commence par UN émoji qui illustre son propos (🏡 🌳 🌿 🏊 🌄 🧱 🔥 🛋️ 🍽️ 🛏️ 🛁 ☀️ 🚗 👨‍👩‍👧 🐓 📍…), et seulement là ;
- 160 caractères au plus pour le texte entier, phrases courtes, sans point d'exclamation, vouvoiement implicite ;
- ne dis que ce qui se voit sur la photo ou ce qui est écrit dans les DONNÉES ; si la photo est ambiguë, mets en valeur un fait des DONNÉES
  qui s'y rapporte ; jamais un équipement ni une qualité que tu ne vois pas et qui n'est pas dans les données ;
- aucun nombre, surface, durée, distance ou année qui ne soit pas écrit dans les DONNÉES, avec la même unité ;
- aucun montant, pas même le prix (il est donné au-dessus du carrousel) ; aucune adresse, aucun nom, rien sur le vendeur, le mandat,
  les honoraires, les frais, les travaux à prévoir ;
- aucun superlatif invérifiable (exceptionnel, unique, idéal, rare, sublime, magnifique, parfait, superbe, incroyable ; exceptional, unique,
  ideal, stunning, perfect, amazing, superb) ; jamais « pas seulement… mais », jamais de liste de négations ;
- deux cartes ne mettent pas en valeur le même attribut.
Un titre court dans chaque langue (60 caractères au plus : le type de bien, son atout principal et la commune, sans prix).
En anglais : un anglais naturel (pas de mot français, sauf « gîte »), mêmes faits, mêmes chiffres.

Réponds en JSON : {"fr": {"titre": "…", "cartes": [{"photo": 1, "texte": "…\\n…"}]}, "en": {"titre": "…", "cartes": [{"photo": 1, "texte": "…\\n…"}]}}

DONNÉES : ${JSON.stringify(donnees)}`;
/* ---------- contrôle d'une ligne ---------- */
const nombre = (s) => {
  let t = String(s || "").replace(/[\s  ]/g, "").replace(/[.,]$/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = parseFloat(t); return isFinite(n) ? n : null;
};
const FAMILLES = [[/^(km|kilom|kilomet|miles?$|m[eè]tres?$|meters?$)/i, "distance"], [/^(minutes?|min$|heures?|hours?|h$)/i, "duree"], [/^(m²|m2|ha$|hectares?|sq)/i, "surface"],
  [/^%/, "pourcent"], [/^(ans$|ann[ée]es?|years?)/i, "age"], [/^(chambres?|bedrooms?)/i, "chambres"], [/^(pi[eè]ces?|rooms?)/i, "pieces"]];
const unites = (t) => {
  const out = [], re = /(\d[\d\s.,]*?)\s*(km|kilom[eè]tres?|kilometers?|miles?|m[eè]tres?\b|meters?\b|m²|m2\b|ha\b|hectares?|sq\.? ?m|minutes?|min\b|heures?\b|hours?\b|h\b|%|ans\b|ann[ée]es?|years?|chambres?|bedrooms?|pi[eè]ces?|rooms?)/gi;
  let m;
  while ((m = re.exec(String(t || "")))) {
    const v = nombre(m[1]); if (v === null) continue;
    const f = FAMILLES.find(([r]) => r.test(m[2])); if (f) out.push(f[1] + ":" + v);
  }
  return out;
};
const permisDe = (donnees) => {
  const texte = JSON.stringify(donnees);
  const p = unites(texte);
  if (donnees.surface) p.push("surface:" + nombre(donnees.surface));
  if (donnees.chambres) p.push("chambres:" + donnees.chambres);
  if (donnees.pieces) p.push("pieces:" + donnees.pieces);
  const annees = (texte.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []);
  return { unites: new Set(p), annees: new Set(annees) };
};
const SUPERLATIFS = /\b(exceptionnel(le)?s?|unique|uniques|id[ée]al(e|es)?|rare|sublime|magnifique|parfait(e|es)?|superbe|incroyable|extraordinaire|splendide|exceptional|ideal|stunning|perfect|amazing|superb|magnificent|incredible|breathtaking)\b/i;
const RESERVES = /honorair|commission|frais (d['e]|de |du |des |inclus|compris|en sus)|mandat|propri[ée]taire|vendeur|cadastr|\bcl[ée]s?\b|adresse|travaux [àa] pr[ée]voir|\bseller\b|\bowner\b|\bfees?\b|\baddress\b|\bkeys?\b|agent fee/i;
const MOTS_FR = /\b(de|la|le|les|et|avec|chambres?|maison|bois|pierre|jardin|vue|campagne|pi[eè]ces?|terrain|chauffage|salle|charme)\b/i;

/* null = ligne valide ; sinon la raison du refus */
const verifierLigne = (ligne, donnees, langue = "fr", max = 120) => {
  const l = String(ligne || "").trim();
  if (!/^\p{Extended_Pictographic}/u.test(l)) return "émoji en tête manquant";
  if (l.length > max) return "longueur";
  if (/!/.test(l)) return "exclamation";
  if (SUPERLATIFS.test(l)) return "superlatif";
  if (/[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|www\./i.test(l) || (l.match(/\+?\d[\d .-]{7,}\d/g) || []).some((m) => m.replace(/\D/g, "").length >= 9)) return "coordonnée";
  if (RESERVES.test(l)) return "sujet réservé";
  const prix = nombre(donnees && donnees.prix);
  for (const m of l.matchAll(/(\d[\d\s.,]*)\s*(k€|€|euros?\b|eur\b)/gi)) {
    const v = nombre(m[1]) * (m[2].toLowerCase() === "k€" ? 1000 : 1);
    if (!prix || Math.abs(v - prix) > 1) return "montant autre que le prix";
  }
  const P = permisDe(donnees || {});
  for (const u of unites(l.replace(/(\d[\d\s.,]*)\s*(k€|€|euros?\b)/gi, ""))) if (!P.unites.has(u)) return "nombre absent des données : " + u;
  for (const a of l.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []) if (!P.annees.has(a)) return "année absente des données : " + a;
  if (langue === "en") {   // les noms propres de l'annonce (commune) ne comptent pas comme du français
    let sans = l.replace(/g[iî]te/gi, "");
    for (const nomPropre of [donnees && donnees.ville].filter(Boolean)) sans = sans.split(nomPropre).join(" ");
    if (MOTS_FR.test(cle(sans))) return "mot français dans une ligne anglaise";
  }
  return null;
};

/* texte d'une carte : 160 caractères (Meta), 3 lignes au plus (2 sauts de ligne), 2 émojis au moins, mêmes contrôles qu'une ligne */
const verifierTexte = (texte, donnees, langue = "fr") => {
  const t = String(texte || "").trim();
  if (t.split("\n").length > 3) return "trop de lignes";
  if (t.length > 160) return "longueur";
  if ((t.match(/\p{Extended_Pictographic}/gu) || []).length < 2) return "pas assez d'émojis";
  for (const l of t.split("\n")) { const r = l.trim() && verifierLigne(l, donnees, langue, 160); if (r) return r; }
  return null;
};

const verifierTitre = (t) => { const s = String(t || "").trim(); return s && s.length <= 80 && !SUPERLATIFS.test(s) && !RESERVES.test(s) && !/!|\d[\d\s.,]*\s*(€|euros?)/i.test(s) ? s : null; };

/* Mise en forme d'une ligne contrôlée : nombres groupés selon la langue (5 505 m² / 5,505 m² ; 225 000 € / €225,000), jamais une année ;
   ponctuation française (espace avant les deux-points). */
const grouper = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
const mettreEnForme = (ligne, langue = "fr") => {
  let l = String(ligne || "").trim();
  l = l.replace(/(\d{4,})(\s*)(m²|m2|ha\b|€)/g, (_, n, esp, u) => (u === "€" && langue === "en" ? "€" + grouper(n, ",") : grouper(n, langue === "en" ? "," : " ") + (esp || " ") + u));
  if (langue === "fr") l = l.replace(/(\S):(\s)/g, "$1 :$2");
  return l;
};

/* ---------- génération ---------- */
const lireJson = (x) => { if (x && typeof x === "object") return x; try { const s = String(x || ""); return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch (e) { return null; } };

/* Le travail confié au bot : la consigne (avec les données triées) et les photos à commenter ; null si moins de 3 photos */
const travail = (bien) => {
  const photos = photosACommenter(bien && bien.photos);
  if (!bien || bien.id == null || photos.length < 2) return null;
  return { bien_id: String(bien.id), empreinte: empreinte(bien), photos, consigne: consignesPhotos(donneesPourCartes(bien), photos.length) };
};

/* La réponse de l'IA (texte JSON ou objet), contrôlée texte par texte : chaque texte reste sous SA photo */
const recevoirCartes = (bien, sortieBrute) => {
  const sortie = lireJson(sortieBrute), photos = photosACommenter(bien && bien.photos), donnees = donneesPourCartes(bien);
  if (!sortie || photos.length < 2) return null;
  const out = { empreinte: empreinte(bien), le: new Date().toISOString(), refus: [] };
  for (const langue of ["fr", "en"]) {
    const s = sortie[langue] || {}, parPhoto = new Map();
    for (const c of Array.isArray(s.cartes) ? s.cartes : []) {
      const n = Math.round(+(c && c.photo)), texte = String((c && c.texte) || "").replace(/\r/g, "").trim();
      if (!(n >= 1 && n <= photos.length) || parPhoto.has(n)) continue;
      const r = verifierTexte(texte, donnees, langue);
      if (r) out.refus.push({ langue, photo: n, texte: texte.slice(0, 170), raison: r });
      else parPhoto.set(n, texte.split("\n").map((l) => mettreEnForme(l, langue)).join("\n"));
    }
    const cartes = [...parPhoto.keys()].sort((x, y) => x - y).map((n) => ({ image: photos[n - 1], texte: parPhoto.get(n) }));
    if (cartes.length >= Math.min(3, photos.length)) out[langue] = { titre: verifierTitre(s.titre), cartes };
  }
  return out.fr || out.en ? out : null;
};

module.exports = { SCHEMA, VERSION, donneesPourCartes, empreinte, consignesPhotos, photosACommenter, verifierLigne, verifierTexte, verifierTitre, mettreEnForme, travail, recevoirCartes };
