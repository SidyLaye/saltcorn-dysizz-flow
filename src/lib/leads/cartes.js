"use strict";
/* Cartes du carrousel du bien, rédigées par l'IA de l'application une fois par bien (et refaites si l'annonce change).
   Une ligne par photo, qui donne envie à partir d'un fait de l'annonce, jamais autre chose. Chaque ligne est contrôlée :
   une ligne fautive est retirée ; une langue avec moins de 3 lignes valides n'est pas rendue (le bot reprend ses lignes de secours).
   Les données envoyées à l'IA sont celles que le bot a le droit de dire (bienPublic + annonce() : rien de la slide 07, aucun montant
   autre que le prix, aucune distance sans unité). */
const crypto = require("crypto");
const B = require("./bot");
const { cle } = require("./texte");

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["fr", "en"],
  properties: Object.fromEntries(["fr", "en"].map((l) => [l, { type: "object", additionalProperties: false, required: ["titre", "lignes"],
    properties: { titre: { type: "string" }, lignes: { type: "array", items: { type: "string" } } } }])),
};

const donneesPourCartes = (bien) => {
  const pub = B.bienPublic(bien) || {}, an = B.annonce(bien && bien.annonce) || {};
  return { ...pub, ...(an.details ? { caracteristiques: an.details } : {}), ...(an.titre_annonce ? { titre_annonce: an.titre_annonce } : {}),
    ...(an.description_annonce ? { description: an.description_annonce } : {}), ...(an.pieces_detail ? { pieces: an.pieces_detail } : {}) };
};

const empreinte = (bien) => crypto.createHash("sha1").update(JSON.stringify([donneesPourCartes(bien), ((bien && bien.photos) || []).length])).digest("hex");

const lignesVoulues = (nbPhotos) => Math.max(3, Math.min(9, (+nbPhotos || 0) - 1));

const consignes = (donnees, nbPhotos) => {
  const n = lignesVoulues(nbPhotos);
  return `Tu rédiges les légendes des photos d'un bien immobilier montré sur WhatsApp à un acheteur qui a déjà répondu à son annonce.
Agence : Sélection Habitat - Agence Hamilton (maisons de caractère, une expérience immobilière à hautes valeurs humaines).
But : donner envie de visiter, avec des faits. L'acheteur achète une vie (le calme, la place, la pierre, la vue), pas une fiche technique.

Écris exactement ${n} lignes en français ET exactement ${n} lignes en anglais, plus un titre court dans chaque langue (60 caractères au plus,
le type de bien, son atout principal et la commune, sans prix).
Chaque ligne :
- commence par UN émoji qui illustre le fait (🏡 🌳 🏊 🌄 🧱 🔥 🛁 🍽️ ☀️ 🚗 📍 💶…), puis un espace ;
- 100 caractères au plus, une seule phrase, sans point d'exclamation ;
- part d'UN fait présent dans les DONNÉES (champ, caractéristique, phrase de la description), et peut dire ce qu'il permet, au conditionnel
  ou comme une possibilité (« de quoi recevoir », « pour les soirées d'hiver ») ; jamais un fait qui n'est pas dans les données ;
- aucun nombre, surface, durée, distance ou année qui ne soit pas écrit dans les données, avec la même unité ;
- aucun montant sauf le prix (une seule ligne de prix, vers la fin) ; aucune adresse, aucun nom, aucune information sur le vendeur, le mandat,
  les honoraires, les frais, les travaux à prévoir ;
- aucun superlatif invérifiable (exceptionnel, unique, idéal, rare, sublime, magnifique, parfait, superbe, incroyable ; exceptional, unique,
  ideal, stunning, perfect, amazing, superb) ;
- jamais « pas seulement… mais », jamais de liste de négations ; ton chaleureux, simple, vouvoiement implicite.
Ordre : d'abord l'atout le plus fort (place, gîte, terrain, vue, caractère), le prix vers la fin. Pas de ligne sur le référent : l'agence l'ajoute.
En anglais : un anglais naturel (pas de mot français, sauf « gîte »), mêmes faits, mêmes chiffres.

Réponds en JSON : {"fr": {"titre": "…", "lignes": ["…"]}, "en": {"titre": "…", "lignes": ["…"]}}

DONNÉES : ${JSON.stringify(donnees)}`;
};

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
const RESERVES = /honorair|commission|frais|mandat|propri[ée]taire|vendeur|cadastr|\bcl[ée]s?\b|adresse|travaux [àa] pr[ée]voir|\bseller\b|\bowner\b|\bfees?\b|\baddress\b|\bkeys?\b|agent fee/i;
const MOTS_FR = /\b(de|la|le|les|et|avec|chambres?|maison|bois|pierre|jardin|vue|campagne|pi[eè]ces?|terrain|chauffage|salle|charme)\b/i;

/* null = ligne valide ; sinon la raison du refus */
const verifierLigne = (ligne, donnees, langue = "fr") => {
  const l = String(ligne || "").trim();
  if (!/^\p{Extended_Pictographic}/u.test(l)) return "émoji en tête manquant";
  if (l.length > 120) return "longueur";
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
  if (langue === "en" && MOTS_FR.test(cle(l.replace(/g[iî]te/gi, "")))) return "mot français dans une ligne anglaise";
  return null;
};

const verifierTitre = (t) => { const s = String(t || "").trim(); return s && s.length <= 80 && !SUPERLATIFS.test(s) && !RESERVES.test(s) && !/!|\d[\d\s.,]*\s*(€|euros?)/i.test(s) ? s : null; };

/* ---------- génération ---------- */
const lireJson = (x) => { if (x && typeof x === "object") return x; try { const s = String(x || ""); return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch (e) { return null; } };

const genererCartes = async (ia, bien) => {
  const donnees = donneesPourCartes(bien);
  let sortie;
  try { sortie = lireJson(await ia.generer(consignes(donnees, ((bien && bien.photos) || []).length), SCHEMA, "cartes")); } catch (e) { return null; }
  if (!sortie) return null;
  const out = { empreinte: empreinte(bien), le: new Date().toISOString(), refus: [] };
  for (const langue of ["fr", "en"]) {
    const s = sortie[langue] || {};
    const lignes = [];
    for (const l of Array.isArray(s.lignes) ? s.lignes : []) { const r = verifierLigne(l, donnees, langue); if (r) out.refus.push({ langue, ligne: String(l).slice(0, 140), raison: r }); else lignes.push(String(l).trim()); }
    if (lignes.length >= 3) out[langue] = { titre: verifierTitre(s.titre), lignes: lignes.slice(0, 9) };
  }
  return out.fr || out.en ? out : null;
};

module.exports = { SCHEMA, donneesPourCartes, empreinte, consignes, lignesVoulues, verifierLigne, verifierTitre, genererCartes };
