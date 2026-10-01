/* Lecture et normalisation des valeurs : téléphone, prix, surface, pièces,
   type de bien, ville / code postal, e-mail. Fonctions pures, sans réseau. */
"use strict";
const { cle } = require("./texte");
const PRENOMS = require("./prenoms");
const estPrenom = (w) => PRENOMS.has(cle(w).split(" ")[0]);

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;

/* Extension collée au mot suivant quand le HTML a perdu une espace (« …@gmail.comdans ») : on coupe à une extension connue. */
const TLD = new Set("com net org fr de be nl uk ch es it eu info io co us ca au ie lu at dk se no fi pt pl cz gr ma sn ci tn dz re biz me tv pro immo gmx".split(" "));
const email = (s) => {
  const m = String(s || "").replace(/^mailto:/i, "").match(EMAIL_RE);
  if (!m) return "";
  let e = m[0].toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "");
  const tld = e.split(".").pop();
  if (!TLD.has(tld) && tld.length > 3) { const k = [...TLD].filter((x) => tld.startsWith(x)).sort((a, b) => b.length - a.length)[0]; if (k) e = e.slice(0, e.length - tld.length + k.length); }
  return e;
};

/* Téléphone → E.164 quand c'est possible (défaut France). Renvoie "" si ce n'est pas un numéro. */
const telephone = (s, pays = "33") => {
  let t = String(s || "").replace(/^tel:/i, "").replace(/\(0\)/g, "").trim();
  if (!/\d/.test(t)) return "";
  const plus = /^\s*\+/.test(t);
  let d = t.replace(/[^\d]/g, "");
  if (d.length < 8 || d.length > 15) return "";
  /* « +33 0783101855 » : le 0 national en trop après l'indicatif */
  if (plus) return "+" + d.replace(/^(33|32|41|44|31|34|49|39)0(?=\d{9}$)/, "$1");
  if (d.startsWith("00")) return "+" + d.slice(2).replace(/^(33|32|41|44|31|34|49|39)0(?=\d{9}$)/, "$1");
  if (/^0[1-9]\d{8}$/.test(d)) return "+" + pays + d.slice(1);
  /* 11 chiffres commençant par 0 (« 07956288684 ») : format britannique, jamais français */
  if (/^0[1237]\d{9}$/.test(d)) return "+44" + d.slice(1);
  if (/^(33|32|41|44|31|34|49|39|351|352|353|221)\d{7,12}$/.test(d) && d.length >= 11) return "+" + d;
  /* 9 chiffres sans 0 ni indicatif : le pays n'est pas écrit. On ne l'invente pas : le numéro reste tel quel,
     et extraire() décide avec le contexte (pays du prospect, e-mail, agence) — voir indicatifContexte(). */
  if (/^[1-9]\d{8}$/.test(d)) return d;
  return d.length >= 10 ? "+" + d : "";
};
/* Indicatif pour un numéro à 9 chiffres sans 0 : seulement si le contexte le dit, et si le numéro a la forme
   d'un numéro de ce pays. Sinon null : le numéro est gardé tel qu'écrit. */
const PAYS_INDICATIF = { france: "33", "pays-bas": "31", netherlands: "31", nederland: "31", belgique: "32", belgium: "32", "royaume-uni": "44", "united kingdom": "44", allemagne: "49", germany: "49", suisse: "41", switzerland: "41", espagne: "34", spain: "34", italie: "39", italy: "39", irlande: "353", ireland: "353", "sénégal": "221", senegal: "221", portugal: "351" };
const TLD_INDICATIF = { fr: "33", nl: "31", be: "32", uk: "44", de: "49", ch: "41", es: "34", it: "39", ie: "353", sn: "221", pt: "351" };
const FORME9 = { "33": /^[1-79]\d{8}$/, "31": /^6\d{8}$/, "32": /^4\d{8}$/, "221": /^7\d{8}$/, "34": /^[67]\d{8}$/, "39": /^3\d{8}$/ };
const indicatifContexte = (nu, { pays, email, senegal } = {}) => {
  const d = String(nu || "");
  if (!/^[1-9]\d{8}$/.test(d)) return null;
  const k = (pays && PAYS_INDICATIF[String(pays).trim().toLowerCase()]) || (senegal ? "221" : null) || (email && TLD_INDICATIF[(String(email).toLowerCase().match(/\.([a-z]{2})$/) || [])[1]]) || null;
  return k && FORME9[k] && FORME9[k].test(d) ? "+" + k + d : null;
};

/* Montant en euros : « 240 000 € », « €379,000 », « EUR 118 000 », « 230,000 € », « 199 000€ 1411.35€/m² ». */
const prix = (s) => {
  const t = String(s || "").replace(/[\u00A0\u202F]/g, " ");
  /* Groupes de milliers avec un séparateur unique (« 693 115,000 » n'est pas un nombre). */
  const N = "(\\d{1,3}(?:( |\\.|,|’|')\\d{3})(?:\\2\\d{3})*|\\d{4,9})";
  const re1 = new RegExp("(?:€|\\beur\\b|\\beuros?\\b)\\s*" + N + "(?![\\d/]|[.,]\\d)", "gi");
  /* « 259000€/La Canourgue » est un prix ; « 1411.35€/m² » ou « 600 €/mois » n'en sont pas */
  const re2 = new RegExp("(?<![\\d.,])" + N + "(?:[.,]\\d{1,2})?\\s*(?:€|\\beur\\b|\\beuros?\\b)(?!\\s*\\/\\s*(?:m\\b|m²|m2|mois|an\\b|month|sem))", "gi");
  const tous = [...t.matchAll(re1), ...t.matchAll(re2)].filter((x) => !/^\s*\/\s*m/i.test(t.slice(x.index + x[0].length, x.index + x[0].length + 4)) && !/capital\s+(social\s+)?(de\s+)?$/i.test(t.slice(Math.max(0, x.index - 25), x.index))).sort((a, b) => a.index - b.index);
  const m = tous[0];
  if (!m) return null;
  const n = +String(m[1]).replace(/[ .,’']/g, "");
  return n >= 1000 && n < 1e8 ? n : null;
};
/* Loyer mensuel : « 600 €/mois », « 600 € par mois charges comprises ». */
const loyer = (s) => { const m = String(s || "").replace(/[\u00A0\u202F]/g, " ").match(/(\d[\d .]{0,6})\s*€\s*(?:\/|par)\s*mois/i); return m ? +m[1].replace(/[ .]/g, "") || null : null; };

const nombre = (s) => { const m = String(s || "").match(/\d+(?:[.,]\d+)?/); return m ? +m[0].replace(",", ".") : null; };
/* Surface habitable : jamais celle du terrain, du jardin ou du parc (« JARDIN 2000 M2 », « terrain de 1 390 m² »). */
const TERRAIN_AVANT = /(?:(?:terrain|land|plot|parcelle|foncier)\s*(?:de |d'|d’|of |:|=)\s*(?:environ |about |~|±)?|(?:jardin|parc|garden|grounds|hectares?)\s*(?:de |d'|d’|of |:|=)?\s*(?:environ |about |~|±)?|(?:sur|avec|with|on)\s+(?:un |une |a )?(?:beau |grand |joli |large )?(?:terrain|jardin|parc|land|plot)\s*(?:de |d'|d’|of )?\s*(?:environ |about )?)\s*$/i;
const TERRAIN_APRES = /^\s*(?:de |d'|d’|of )?(?:terrain|jardin|parc|land|plot|garden|grounds|parcelle)/i;
const surface = (s) => {
  const t = String(s || "").replace(/[\u00A0\u202F]/g, " ");
  for (const m of t.matchAll(/(?<![\d.,])(\d{1,3}(?: \d{3})?|\d{1,6})(?:[.,](\d+))?\s*(?:m²|m2|sq\.? ?m)(?![\w²])/gi)) {
    const avant = t.slice(Math.max(0, m.index - 30), m.index), apres = t.slice(m.index + m[0].length, m.index + m[0].length + 20);
    /* le bien EST un terrain (« Terrain 2244 m² NASSIET ») : sa surface est celle du terrain */
    if (!/^\s*(terrain|land|plot|parcelle)\b/i.test(t) && (TERRAIN_AVANT.test(avant) || TERRAIN_APRES.test(apres))) continue;
    const n = +(m[1].replace(/\s/g, "") + (m[2] ? "." + m[2] : ""));
    if (n > 5 && n < 100000) return Math.round(n);
  }
  return null;
};
const pieces = (s) => { const m = String(s || "").match(/(\d{1,2})\s*(?:pièces?|pieces?|pi[eè]ce\(s\)|p\b|rooms?)/i); return m ? +m[1] : null; };
const chambres = (s) => { const m = String(s || "").match(/(\d{1,2})\s*(?:chambres?|ch\b|bedrooms?|beds?)/i); return m ? +m[1] : null; };

const TYPES = [
  ["appartement", /\b(appartement|appart|apartment|flat|duplex|triplex|studio|loft|penthouse)\b/],
  ["terrain", /\b(terrain|land|plot)\b/],
  ["immeuble", /\b(immeuble|building)\b/],
  ["local", /\b(local|commerce|bureau|fonds de commerce|entrepot|hangar)\b/],
  ["grange", /\b(grange|remise|barn|ruine)\b/],
  ["chateau", /\b(chateau|castle|manoir|manor)\b/],
  ["propriete", /\b(propriete|domaine|property|estate|mas|bastide|longere|moulin|corps de ferme|ferme|farmhouse)\b/],
  ["maison", /\b(maison|villa|house|home|pavillon|chalet|cottage|gite|maison de ville|maison de village)\b/],
];
const typeBien = (s) => { const k = cle(s); for (const [t, re] of TYPES) if (re.test(k)) return t; return ""; };

/* Ville + code postal : « Carcassonne (11000) », « 09230 LASSERRE », « CARDAILLAC , 46100 », « Chancelade (24) ». */
const lieu = (s) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  let m = t.match(/^(.{2,60}?)\s*\(\s*(\d{5}|\d{2}|2[AB])\s*\)/i);
  if (m) return m[2].length === 5 ? { ville: m[1].trim(), code_postal: m[2] } : { ville: m[1].trim(), departement: m[2] };
  m = t.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ' -]{2,60})$/);
  if (m) return { ville: m[2].trim(), code_postal: m[1] };
  m = t.match(/^([A-Za-zÀ-ÿ' -]{2,60}?)\s*[,-]?\s*(\d{5})$/);
  if (m) return { ville: m[1].trim(), code_postal: m[2] };
  return {};
};

/* Titre d'annonce type « Maison 15 pièces 427 m² » → faits. */
const faitsTitre = (s) => {
  const o = {};
  const ty = typeBien(s); if (ty) o.type = ty;
  const p = pieces(s); if (p) o.pieces = p;
  const su = surface(s); if (su) o.surface = su;
  const c = chambres(s); if (c) o.chambres = c;
  const pr = prix(s); if (pr) o.prix = pr;
  return o;
};

const nomPropre = (s) => String(s || "").replace(/\s+/g, " ").trim()
  .replace(/^(m\.|mr\.?|mme\.?|mrs\.?|ms\.?|mlle|monsieur|madame|mister|miss)\s+/i, "")
  .replace(/[«»"“”]+/g, "").slice(0, 120);

/* « Taurisson - Célia », « Célia Taurisson », « TAURISSON Célia » → { nom, prenom }.
   Ordre décidé par : liste de prénoms, puis majuscules, puis l'ordre indiqué par le portail. */
const decouperNom = (s, ordre = "auto") => {
  const t = nomPropre(s).replace(/\s+(et|and|&)\s+.*$/i, (m) => m);
  if (!t) return {};
  const tiret = t.split(/\s[-–]\s/);
  const mots = tiret.length === 2 ? tiret.map((x) => x.trim()) : t.split(" ");
  if (mots.length === 1) return estPrenom(t) ? { prenom: t } : { nom: t };
  const premier = mots[0], dernier = mots[mots.length - 1];
  const a = { prenom: premier, nom: mots.slice(1).join(" ") }, b = { nom: premier, prenom: mots.slice(1).join(" ") };
  /* Majuscules d'origine (« MATHIEU Jérémie ») : le mot tout en capitales est le nom. */
  const orig = String(s || "").trim().split(/\s+/);
  const maj = (w) => w && w.length > 1 && w === w.toUpperCase() && /[A-ZÀ-Ÿ]/.test(w);
  if (orig.length === mots.length && maj(orig[0]) !== maj(orig[orig.length - 1])) return maj(orig[0]) ? b : a;
  const pa = estPrenom(premier), pb = estPrenom(dernier);
  if (pa && !pb) return a;
  if (pb && !pa) return mots.length === 2 ? b : { prenom: dernier, nom: mots.slice(0, -1).join(" ") };
  if (ordre === "nom_prenom" || (tiret.length === 2 && ordre !== "prenom_nom")) return b;
  return a;
};

module.exports = { indicatifContexte, loyer, estPrenom, EMAIL_RE, email, telephone, prix, nombre, surface, pieces, chambres, typeBien, lieu, faitsTitre, nomPropre, decouperNom };
