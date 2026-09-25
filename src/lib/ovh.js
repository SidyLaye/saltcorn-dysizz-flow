/* Client API OVHcloud signé (clés « APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY »).
   - décalage d'horloge mesuré une fois (/auth/time) puis réutilisé ;
   - signature « $1$ » + sha1(AS+CK+méthode+url+corps+horodatage) ;
   - reprise sur 429 / 5xx, message d'erreur OVH lisible ;
   - liste d'identifiants → objets détaillés avec une concurrence bornée. */
"use strict";
const crypto = require("crypto");

const BASES = { "ovh-eu": "https://eu.api.ovh.com/1.0", "ovh-ca": "https://ca.api.ovh.com/1.0", "ovh-us": "https://api.us.ovhcloud.com/1.0" };
const decalages = new Map();

const client = ({ cles, zone = "ovh-eu", fetch: f = fetch } = {}) => {
  const [ak, as, ck] = String(cles || "").split(":").map((s) => s.trim());
  if (!ak || !as) throw Object.assign(new Error("clés OVH attendues : « APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY »"), { permanent: true });
  const B = BASES[zone] || BASES["ovh-eu"];
  const maintenant = async () => {
    if (!decalages.has(B)) { const t = +(await (await f(`${B}/auth/time`)).text()); decalages.set(B, t - Math.floor(Date.now() / 1000)); }
    return Math.floor(Date.now() / 1000) + decalages.get(B);
  };
  const appel = async (methode, chemin, corps, { signe = true } = {}) => {
    const url = B + chemin, body = corps === undefined || corps === null ? "" : JSON.stringify(corps);
    for (let essai = 1; essai <= 3; essai++) {
      const h = { "X-Ovh-Application": ak, "Content-Type": "application/json", Accept: "application/json" };
      if (signe) {
        if (!ck) throw Object.assign(new Error("CONSUMER_KEY manquante : utilise « OVH : créer une clé d'accès »"), { permanent: true });
        const t = String(await maintenant());
        h["X-Ovh-Consumer"] = ck; h["X-Ovh-Timestamp"] = t;
        h["X-Ovh-Signature"] = "$1$" + crypto.createHash("sha1").update([as, ck, methode, url, body, t].join("+")).digest("hex");
      }
      const r = await f(url, { method: methode, headers: h, body: body || undefined });
      const txt = await r.text();
      let j; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
      if ((r.status === 429 || r.status >= 500) && essai < 3) { await new Promise((ok) => setTimeout(ok, 800 * essai)); continue; }
      if (r.status === 400 && /timestamp/i.test(txt) && essai < 3) { decalages.delete(B); continue; }
      if (!r.ok) {
        const msg = (j && (j.message || j.errorCode)) || txt.slice(0, 200);
        throw Object.assign(new Error(`OVH ${methode} ${chemin} → HTTP ${r.status} : ${msg}`), { http: r.status, permanent: r.status === 400 || r.status === 403 || r.status === 404 || r.status === 409 });
      }
      return j;
    }
  };
  const detailler = async (cheminListe, cheminObjet, { max = 200, concurrence = 8 } = {}) => {
    const ids = ((await appel("GET", cheminListe)) || []).slice(0, max);
    const out = new Array(ids.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(concurrence, ids.length) }, async () => {
      while (i < ids.length) { const k = i++; try { out[k] = await appel("GET", cheminObjet(ids[k])); } catch (e) { out[k] = { id: ids[k], erreur: e.message }; } }
    }));
    return out;
  };
  return {
    get: (c) => appel("GET", c), post: (c, b) => appel("POST", c, b ?? {}), put: (c, b) => appel("PUT", c, b ?? {}), del: (c) => appel("DELETE", c),
    appel, detailler, base: B, ak,
  };
};

/* Demande d'une clé d'accès (consumer key) : OVH renvoie un lien à valider une fois. */
const demanderCle = async ({ ak, zone = "ovh-eu", droits, retour, fetch: f = fetch }) => {
  const B = BASES[zone] || BASES["ovh-eu"];
  const r = await f(`${B}/auth/credential`, { method: "POST", headers: { "X-Ovh-Application": ak, "Content-Type": "application/json" }, body: JSON.stringify({ accessRules: droits, redirection: retour || undefined }) });
  const j = await r.json();
  if (!r.ok) throw new Error("OVH : " + (j.message || r.status));
  return j;
};

const enc = (s) => encodeURIComponent(String(s || "").trim());

module.exports = { client, demanderCle, BASES, enc };
