/* Lecture et normalisation des valeurs : téléphone, prix, surface, pièces,
   type de bien, ville / code postal, e-mail. Fonctions pures, sans réseau. */
"use strict";
const { cle } = require("./texte");
const PRENOMS = require("./prenoms");
const estPrenom = (w) => PRENOMS.has(cle(w).split(" ")[0]);

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;

const email = (s) => {
  const m = String(s || "").replace(/^mailto:/i, "").match(EMAIL_RE);
  return m ? m[0].toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "") : "";
};

/* Téléphone → E.164 quand c'est possible (défaut France). Renvoie "" si ce n'est pas un numéro. */
const telephone = (s, pays = "33") => {
  let t = String(s || "").replace(/^tel:/i, "").replace(/\(0\)/g, "").trim();
  if (!/\d/.test(t)) return "";
  const plus = /^\s*\+/.test(t);
  let d = t.replace(/[^\d]/g, "");
  if (d.length < 8 || d.length > 15) return "";
  if (plus) return "+" + d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (/^0[1-9]\d{8}$/.test(d)) return "+" + pays + d.slice(1);
  if (/^(33|32|41|44|31|34|49|39|351|352|353|1)\d{7,12}$/.test(d) && d.length >= 10) return "+" + d;
  if (/^[67]\d{8}$/.test(d) && pays === "33") return "+33" + d;
  return d.length >= 9 ? "+" + d : "";
};

/* Montant en euros : « 240 000 € », « €379,000 », « EUR 118 000 », « 230,000 € », « 199 000€ 1411.35€/m² ». */
const prix = (s) => {
  const t = String(s || "").replace(/[\u00A0\u202F]/g, " ");
  /* Groupes de milliers avec un séparateur unique (« 693 115,000 » n'est pas un nombre). */
  const N = "(\\d{1,3}(?:( |\\.|,|’|')\\d{3})(?:\\2\\d{3})*|\\d{4,9})";
  const re1 = new RegExp("(?:€|\\beur\\b|\\beuros?\\b)\\s*" + N + "(?![\\d/]|[.,]\\d)", "gi");
  const re2 = new RegExp("(?<![\\d.,])" + N + "(?:[.,]\\d{1,2})?\\s*(?:€|\\beur\\b|\\beuros?\\b)(?!\\s*\\/)", "gi");
  const tous = [...t.matchAll(re1), ...t.matchAll(re2)].filter((x) => !/^\s*\/\s*m/i.test(t.slice(x.index + x[0].length, x.index + x[0].length + 4))).sort((a, b) => a.index - b.index);
  const m = tous[0];
  if (!m) return null;
  const n = +String(m[1]).replace(/[ .,’']/g, "");
  return n >= 1000 && n < 1e9 ? n : null;
};

const nombre = (s) => { const m = String(s || "").match(/\d+(?:[.,]\d+)?/); return m ? +m[0].replace(",", ".") : null; };
const surface = (s) => { const m = String(s || "").replace(/[\u00A0\u202F]/g, " ").match(/(?<![\d.,])(\d{1,3}(?: \d{3})?|\d{1,6})(?:[.,](\d+))?\s*(?:m²|m2|sq\.? ?m)/i); if (!m) return null; const n = +(m[1].replace(/\s/g, "") + (m[2] ? "." + m[2] : "")); return n > 5 && n < 100000 ? Math.round(n) : null; };
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
  const pa = estPrenom(premier), pb = estPrenom(dernier);
  if (pa && !pb) return a;
  if (pb && !pa) return mots.length === 2 ? b : { prenom: dernier, nom: mots.slice(0, -1).join(" ") };
  const maj = (w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  if (maj(premier) && !maj(dernier)) return b;
  if (maj(dernier) && !maj(premier)) return a;
  if (ordre === "nom_prenom" || (tiret.length === 2 && ordre !== "prenom_nom")) return b;
  return a;
};

module.exports = { estPrenom, EMAIL_RE, email, telephone, prix, nombre, surface, pieces, chambres, typeBien, lieu, faitsTitre, nomPropre, decouperNom };
