"use strict";

/* HTTP borné, corps inclus. Les écritures ne sont rejouées que lorsque
   l'administrateur déclare explicitement leur idempotence. */
const appeler = async (p, { fetch: f = fetch, attendre = ms => new Promise(r => setTimeout(r, ms)) } = {}) => {
  const url = new URL(p.url);
  if (!["https:", "http:"].includes(url.protocol)) throw Object.assign(new Error("protocole HTTP requis"), { permanent: true });
  const methode = String(p.methode || "GET").toUpperCase();
  const sur = ["GET", "HEAD", "OPTIONS"].includes(methode) || p.rejouer_ecriture === true;
  const essais = sur ? Math.max(1, Math.min(3, Number(p.tentatives_max) || 1)) : 1;
  const delai = Math.max(1, Math.min(15000, (Number(p.delai_s) || 15) * 1000));
  let dernier;
  for (let i = 1; i <= essais; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), delai);
    try {
      const r = await f(url.href, {
        method: methode, headers: p.entetes || {}, signal: ctrl.signal,
        body: ["GET", "HEAD"].includes(methode) || p.corps == null || p.corps === "" ? undefined : typeof p.corps === "string" ? p.corps : JSON.stringify(p.corps),
        redirect: "error",
      });
      const texte = await r.text();
      dernier = { status: r.status, ok: r.ok, texte, entetes: Object.fromEntries([...r.headers.entries()].filter(([k]) => /^(content-type|retry-after|x-ratelimit)/i.test(k))) };
      if (!sur && r.status >= 500) throw Object.assign(new Error("Résultat d'écriture HTTP inconnu ; vérifier avant reprise"), { ambiguous: true, permanent: true, http: r.status });
      if (r.status !== 429 && r.status < 500) return dernier;
    } catch (e) {
      if (!sur) throw Object.assign(new Error("Résultat d'écriture HTTP inconnu ; vérifier avant reprise"), { cause: e, ambiguous: true, permanent: true });
      if (i === essais) throw Object.assign(new Error("Appel HTTP interrompu ou délai dépassé"), { cause: e, permanent: true });
      dernier = null;
    } finally { clearTimeout(timer); }
    if (i < essais) {
      const h = dernier?.entetes?.["retry-after"];
      const ms = h && Number.isFinite(Number(h)) ? Number(h) * 1000 : i * 500;
      await attendre(Math.max(0, Math.min(ms, 15000)));
    }
  }
  return dernier;
};
module.exports = { appeler };
