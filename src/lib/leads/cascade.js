/* Cascade avant l'IA (Sidy, 09/11 : « fais tous les 3 » ; recherche : un filtre bon marché d'abord, le grand modèle pour le doute).
   L'empreinte de sens d'un mail inconnu (text-embedding-3-small, 256 nombres) est comparée à celles des mails déjà lus par l'IA.
   Ses 3 plus proches voisins sont tous des publicités à 90 % de ressemblance ou plus, et aucun lead ne lui ressemble à plus de 70 % :
   il est classé publicité sans appel à l'IA. Sinon, ou en cas d'erreur, l'IA le lit.
   Rejeu du 09/11 sur 40 jours, chaque mail comparé aux seuls mails reçus avant lui (1 753 mails, 123 vrais leads) : 41 % d'appels
   évités, aucun vrai lead perdu ; aucune erreur non plus à 80 % (marge). Un seul voisin perdait des leads : jamais moins de 3. */
"use strict";

const DIMS = 256, K = 3, SEUIL = 0.9, GARDE = 0.7;
const LEADS = ["lead", "relance", "recherche", "estimation", "direct", "reponse_campagne"], NON = ["notification", "autre", "non_lead", "test", "masse"];

/* même texte que le rejeu : l'objet puis le début du corps */
const texteEmpreinte = (m, texte) => ("Objet : " + String((m && m.objet) || "") + "\n" + String(texte || "")).slice(0, 2000);
/* les 256 premiers nombres, remis à la longueur 1 (équivaut au réglage « dimensions: 256 » d'OpenAI) */
const reduire = (v) => {
  const r = new Float32Array(DIMS); let n = 0;
  for (let i = 0; i < DIMS; i++) { r[i] = +((v && v[i]) || 0); n += r[i] * r[i]; }
  n = Math.sqrt(n);
  if (!n) return null;
  for (let i = 0; i < DIMS; i++) r[i] /= n;
  return r;
};
const versTexte = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString("base64");
const depuisTexte = (s) => { const b = Buffer.from(String(s || ""), "base64"); return b.length === DIMS * 4 ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) : null; };
const etiquette = (nature, statut) => (LEADS.includes(nature) || ["pret", "a_verifier"].includes(statut) ? "lead" : NON.includes(nature) ? "non" : null);
const produit = (a, b) => { let s = 0; for (let i = 0; i < DIMS; i++) s += a[i] * b[i]; return s; };

/* refs : [{ v: Float32Array, etiquette: "lead" | "non" }] */
const decider = (v, refs, { k = K, seuil = SEUIL, garde = GARDE } = {}) => {
  if (!v || !refs || refs.length < k) return { eviter: false, voisins: [] };
  const s = refs.map((r) => [produit(v, r.v), r.etiquette]).sort((a, b) => b[0] - a[0]).slice(0, 10);
  const top = s.slice(0, k);
  const eviter = top.every(([x, e]) => e === "non" && x >= seuil) && !s.some(([x, e]) => e === "lead" && x >= garde);
  return { eviter, ressemblance: Math.floor(top[k - 1][0] * 100), voisins: top.map(([x, e]) => [Math.round(x * 1000) / 1000, e]) };
};

module.exports = { texteEmpreinte, reduire, versTexte, depuisTexte, etiquette, decider, DIMS, K, SEUIL, GARDE };
