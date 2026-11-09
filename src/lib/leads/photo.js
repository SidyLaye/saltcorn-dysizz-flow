/* Recherche par photo (Sidy, 09/11 : « on retrouve via pourcentage de matching sur tous les critères dispo dont photo ») :
   quand la recherche par critères hésite entre quelques biens, ou n'a pas assez de preuves pour le seul bien qui concorde,
   la photo de l'annonce reçue dans le mail est comparée à celles de ces biens dans le CRM.
   Empreintes de 64 bits : dHash (différences de luminosité) et pHash (basses fréquences de la DCT), calculées avec sharp,
   déjà installé avec Saltcorn ; sans sharp, rien n'est comparé. Écart = somme des deux distances (0 à 128).
   Banc du 09/11 (75 vrais leads, 99 biens) : même photo redimensionnée par le portail = écart 0 à 25 ;
   photos de biens différents = 36 et plus. */
"use strict";

const MEME = 26, DIFFERENTE = 34;
/* images qui ne sont pas des photos de bien : logos, pictos, pixels de suivi, cartes, signatures */
const BRUIT = /(logo|icon|ico-|pixel|spacer|track|\/open|\/o\.gif|\/oo\/|facebook|twitter|linkedin|instagram|youtube|badge|arrow|picto|transparent|banner|appstore|avatar|xiti|hit\.|static\/emails|agent_data\/mail|mcusercontent|customeriomail|sendgrid|signature|map_|maps?\.|staticmap|email-assets|\.gif(\?|$))/i;

const imagesDuMail = (html) => [...new Set((String(html || "").match(/<img\b[^>]*?\bsrc\s*=\s*["'][^"']+["']/gi) || [])
  .map((t) => t.replace(/^[\s\S]*\bsrc\s*=\s*["']/i, "").replace(/["']$/, "").replace(/&amp;/g, "&"))
  .filter((u) => /^https:\/\//i.test(u) && !BRUIT.test(u)))].slice(0, 6);

/* sharp de Saltcorn (absent du plugin : il est trouvé depuis le programme principal) */
let SHARP;
const outil = () => {
  if (SHARP !== undefined) return SHARP;
  try { SHARP = require("sharp"); } catch (e) {
    try { SHARP = require(require.resolve("sharp", { paths: (require.main && require.main.paths) || [] })); } catch (e2) { SHARP = null; }
  }
  return SHARP;
};

const COS = (() => { const n = 32, c = []; for (let u = 0; u < 8; u++) { c[u] = []; for (let x = 0; x < n; x++) c[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)); } return c; })();
/* image → { d, p } (64 bits chacun, tableaux de 0/1) ; null : pas une photo (trop petite, bandeau) ou illisible */
const empreinte = async (buf, s = outil()) => {
  if (!s || !buf || !buf.length) return null;
  try {
    const m = await s(buf).metadata();
    if (!m.width || !m.height || m.width < 90 || m.height < 60 || m.width / m.height > 4 || m.height / m.width > 3) return null;
    const a = await s(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    const d = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d.push(a[y * 9 + x + 1] > a[y * 9 + x] ? 1 : 0);
    const g = await s(buf).grayscale().resize(32, 32, { fit: "fill" }).raw().toBuffer();
    const bas = [];
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let t = 0; for (let y = 0; y < 32; y++) { let l = 0; for (let x = 0; x < 32; x++) l += g[y * 32 + x] * COS[v][x]; t += l * COS[u][y]; } bas.push(t); }
    const med = [...bas.slice(1)].sort((p, q) => p - q)[31];
    return { d, p: bas.map((x) => (x > med ? 1 : 0)) };
  } catch (e) { return null; }
};
const ecart = (a, b) => { let n = 0; for (let i = 0; i < 64; i++) { if (a.d[i] !== b.d[i]) n++; if (a.p[i] !== b.p[i]) n++; } return n; };

/* Les adresses d'images viennent des mails reçus : un mail piégé ne doit pas faire lire au serveur une adresse interne.
   https seulement (un service interne sans certificat valide pour ce nom ne reçoit même pas la requête), port 443, pas
   d'identifiants, pas d'adresse IP écrite, nom résolu vers des adresses publiques seulement, aucune redirection.
   ponytail: l'adresse résolue n'est pas épinglée pour la connexion (rebinding DNS) ; https rend l'attaque sans effet utile. */
const PRIVEES4 = [[0, 8], [10, 8], [100 << 24 | 64 << 16, 10], [127 << 24, 8], [169 << 24 | 254 << 16, 16], [172 << 24 | 16 << 16, 12], [192 << 24, 24], [192 << 24 | 168 << 16, 16], [198 << 24 | 18 << 16, 15], [224 << 24, 3]]
  .map(([b, n]) => [n === 8 && b < 256 ? b << 24 : b, n]);
const privee = (ip) => {
  const v = String(ip).replace(/^::ffff:/i, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) { const x = v.split(".").reduce((a, o) => ((a << 8) | +o) >>> 0, 0); return PRIVEES4.some(([b, n]) => ((x ^ (b >>> 0)) >>> (32 - n)) === 0); }
  return /^(::1?|f[cd]|fe[89ab])/i.test(v) || v === "";
};
const adresseSure = async (url, resoudre = (h) => require("dns").promises.lookup(h, { all: true })) => {
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || /^[\d.]+$|[:[\]]/.test(u.hostname) || !u.hostname.includes(".")) return false;
  const l = await resoudre(u.hostname).catch(() => []);
  return l.length > 0 && !l.some((a) => privee(a.address));
};

/* image JPEG/PNG/WebP, 5 Mo et 6 s au plus ; une erreur ou une adresse refusée = photo absente */
const charger = async (url, f = globalThis.fetch, { octets = 5e6, delai = 6000, resoudre } = {}) => {
  if (!(await adresseSure(url, resoudre))) return null;
  const c = new AbortController(), minuteur = setTimeout(() => c.abort(), delai);
  try {
    const r = await f(url, { signal: c.signal, redirect: "error", headers: { "User-Agent": "Mozilla/5.0 (compatible; dysizz-flow)" } });
    if (!r.ok || !/image\/(jpe?g|png|webp)/i.test((r.headers && r.headers.get("content-type")) || "")) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length && b.length <= octets ? b : null;
  } catch (e) { return null; } finally { clearTimeout(minuteur); }
};

/* écart photo de chaque bien candidat : Map(id → plus petit écart entre une photo du mail et une de ses photos).
   Les photos du mail sont lues une fois ; 3 photos par bien (le portail montre la première). Rien n'est gardé. */
const distances = async (images, biens, { photosDe, charger: ch = charger, empreinte: em = empreinte, parBien = 3, budget_ms = 25000 } = {}) => {
  const fin = Date.now() + budget_ms, out = new Map();
  if (!images || !images.length || !biens.length || !photosDe || (em === empreinte && !outil())) return out;
  const du = (await Promise.all(images.map(async (u) => em(await ch(u))))).filter(Boolean);
  if (!du.length) return out;
  await Promise.all(biens.map(async (b) => {
    if (Date.now() > fin) return;
    const urls = ((await photosDe(b).catch(() => [])) || []).slice(0, parBien);
    const hs = (await Promise.all(urls.map(async (u) => (Date.now() > fin ? null : em(await ch(u)))))).filter(Boolean);
    if (hs.length) out.set(String(b.id), Math.min(...du.flatMap((a) => hs.map((h) => ecart(a, h)))));
  }));
  return out;
};

module.exports = { imagesDuMail, empreinte, ecart, distances, charger, adresseSure, privee, outil, MEME, DIFFERENTE };
