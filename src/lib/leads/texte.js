/* Normalisation d'un mail entrant : HTML → texte ligne à ligne, entités,
   caractères cassés (UTF-8 lu en Latin-1), espaces. Tout est déterministe. */
"use strict";

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë", euro: "€", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "—", middot: "·", bull: "•", sup2: "²", deg: "°", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç" };

const entites = (s) => String(s)
  .replace(/&#(\d+);?/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return " "; } })
  .replace(/&#x([0-9a-f]+);?/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return " "; } })
  .replace(/&([a-z]+\d?);/gi, (m, n) => (ENT[n] !== undefined ? ENT[n] : m));

/* « Ã© » → « é » : texte UTF-8 décodé en Latin-1. On ne répare que si le motif est présent. */
const reparer = (s) => {
  if (!/Ã[\x80-\xBF©¨ª«§¢®´¹¼½¾ ]|Â[\xA0-\xBF]|â€/.test(s)) return s;
  try {
    const b = Buffer.from(s, "latin1").toString("utf8");
    return /�/.test(b) ? s : b;
  } catch (e) { return s; }
};

const htmlTexte = (html) => entites(String(html || "")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
  .replace(/<a\b[^>]*href\s*=\s*["']?(mailto:|tel:)([^"'\s>]+)[^>]*>/gi, " $1$2 ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|li|tr|h\d|table|td|th|dt|dd|blockquote|section|article)\s*>/gi, "\n")
  .replace(/<(td|th)\b[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, " "));

const lignes = (t) => String(t)
  .replace(/\r\n?/g, "\n")
  .replace(/(^|\n)[^\n{}]{0,80}\{[^{}]{0,1500}?\}/g, (m, a) => (/[;:]\s*[\w#-]/.test(m) && !/[.!?]\s*$/.test(m.split("{")[0]) ? a : m)).replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "")
  .split("\n").map((l) => l.replace(/[ \t\f\v]+/g, " ").trim()).filter(Boolean);

/* Texte exploitable d'un mail : le texte brut s'il est vraiment du texte, sinon le HTML converti. */
const texteMail = ({ texte, html } = {}) => {
  const t = String(texte || "");
  const brut = t.trim() && !/^\s*<(!doctype|html)/i.test(t) && t.replace(/\s/g, "").length > 80;
  const src = brut ? entites(t) : htmlTexte(html || t);
  return lignes(reparer(src).replace(/([a-zà-ÿA-ZÀ-Ÿ)])(E-?mail|T[ée]l[ée]phone|Phone)\s*:/g, "$1\n$2 :").replace(/[\[<(]\s*https?:\/\/[^\s\]>)]*\s*[\]>)]/g, " ").replace(/https?:\/\/\S{70,}/g, " ")).join("\n");
};

/* Tous les liens du mail (href du HTML + URL du texte), dédoublonnés. */
const liens = ({ texte, html } = {}) => {
  const out = new Set();
  String(html || "").replace(/href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi, (_, u) => out.add(entites(u)));
  String(texte || "").replace(/https?:\/\/[^\s\]>)"'<]+/g, (u) => out.add(u));
  return [...out];
};

const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const cle = (s) => sansAccent(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Coupe l'historique cité d'une réponse (« Le … a écrit : », « De : … Envoyé : », « > »). */
const sansCitation = (t) => {
  const L = String(t).split("\n"), out = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^(>|&gt;)/.test(l)) break;
    if (/^(le|on) .{4,90}(a écrit|wrote)\s*:?\s*$/i.test(l)) break;
    if (/^-{2,}\s*(original message|message d'origine|message transféré|forwarded message)/i.test(l)) break;
    if (/^(de|from)\s*:/i.test(l) && L.slice(i + 1, i + 5).some((x) => /^(envoyé|sent|date|à|to|objet|subject)\s*:/i.test(x))) break;
    out.push(l);
  }
  return out.join("\n");
};

module.exports = { liens, entites, reparer, htmlTexte, lignes, texteMail, sansAccent, cle, sansCitation };
