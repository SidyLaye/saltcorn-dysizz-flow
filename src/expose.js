/* Exposition : tes propres points d'API publics.
     GET|POST /dzf/api/<nom>
   Chaque point (table dzf_points) lance un workflow Saltcorn et renvoie une
   variable de son contexte en JSON. Protections, au choix par point :
     - aucune      : public (ex. un formulaire de contact)
     - jeton       : en-tête « Authorization: Bearer <jeton> » ou « X-Api-Key »
     - hmac        : signature HMAC-SHA256 du corps brut dans un en-tête
                     (GitHub, Stripe, Shopify… ou tes propres services)
   + limite de requêtes par minute et par adresse IP, taille de corps limitée,
   comparaison en temps constant, jamais de détail d'erreur interne renvoyé. */
"use strict";
const crypto = require("crypto");
const { ensureTables } = require("./store");

const NOM_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const MAX_BODY = 1024 * 1024;
const AUTHS = ["aucune", "jeton", "hmac"];
const METHODES = ["POST", "GET", "GET et POST"];

/* petite mémoire des points pour ne pas relire la table à chaque appel (30 s) */
const CACHE = new Map();
const findPoint = async (nom) => {
  const db = require("@saltcorn/data/db");
  const key = `${db.getTenantSchema()}:${nom}`;
  const hit = CACHE.get(key);
  if (hit && hit.t > Date.now() - 30e3) return hit.p;
  const { points } = await ensureTables();
  const p = await points.getRow({ nom });
  CACHE.set(key, { t: Date.now(), p });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  return p;
};
const forget = () => CACHE.clear();

const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const secretOf = async (name) => {
  if (!name) return undefined;
  if (process.env[name]) return process.env[name];
  const { readSecret } = require("./vault");
  return readSecret(name);
};
/* en-têtes transmis au workflow : jamais les cookies ni l'autorisation */
const safeHeaders = (h = {}) => Object.fromEntries(Object.entries(h).filter(([k]) => !/^(cookie|authorization|x-api-key|proxy-authorization)$/i.test(k)).map(([k, v]) => [k, String(v).slice(0, 500)]));
const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || "").replace(/^::ffff:/, "");

const PUBLIC = { role_id: 100 };
const runAs = async (email) => {
  if (!email) return PUBLIC;
  const User = require("@saltcorn/data/models/user");
  const u = await User.findOne({ email });
  return u ? (u.session_object || u) : PUBLIC;
};

const reply = (res, code, body) => { res.status(code); res.setHeader("Cache-Control", "no-store"); res.json(body); };

const handle = async (req, res) => {
  const t0 = Date.now();
  const nom = String((req.params && req.params.nom) || "");
  try {
    if (!NOM_RE.test(nom)) return reply(res, 404, { erreur: "introuvable" });
    const p = await findPoint(nom);
    if (!p || !p.actif) return reply(res, 404, { erreur: "introuvable" });
    const m = req.method.toUpperCase();
    const allowed = p.methode === "GET et POST" ? ["GET", "POST"] : [p.methode || "POST"];
    if (!allowed.includes(m)) { res.setHeader("Allow", allowed.join(", ")); return reply(res, 405, { erreur: "méthode non autorisée" }); }

    /* limite de débit (Redis si présent, sinon table cache) */
    const lim = +p.limite_minute || 60;
    const { kv } = require("./blocks/controle");
    const n = await kv.incr(`dzf:api:${nom}:${clientIp(req)}:${Math.floor(Date.now() / 60e3)}`, 90);
    res.setHeader("X-RateLimit-Limit", String(lim));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, lim - n)));
    if (n > lim) { res.setHeader("Retry-After", "60"); return reply(res, 429, { erreur: "trop de requêtes, réessaie dans une minute" }); }

    const raw = typeof req.rawBody === "string" ? req.rawBody : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString("utf8") : req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : "";
    if (raw.length > MAX_BODY) return reply(res, 413, { erreur: "corps trop gros" });

    /* authentification */
    if (p.auth === "jeton") {
      const want = await secretOf(p.secret);
      const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.headers["x-api-key"];
      if (!want || !same(got, want)) return reply(res, 401, { erreur: "jeton invalide" });
    } else if (p.auth === "hmac") {
      const key = await secretOf(p.secret);
      const got = String(req.headers[String(p.en_tete_signature || "x-signature").toLowerCase()] || "").replace(/^sha256=/, "");
      const want = key && crypto.createHmac("sha256", key).update(raw).digest("hex");
      if (!want || !same(got, want)) return reply(res, 401, { erreur: "signature invalide" });
    } else if (p.auth !== "aucune") return reply(res, 500, { erreur: "point mal configuré" });

    const Trigger = require("@saltcorn/data/models/trigger");
    const wf = Trigger.findOne({ name: p.workflow });
    if (!wf) return reply(res, 500, { erreur: "workflow absent" });
    let corps = req.body;
    if ((!corps || !Object.keys(corps).length) && raw) { try { corps = JSON.parse(raw); } catch (e) { corps = raw; } }
    const ctx = { corps: corps || {}, corps_brut: raw, query: { ...(req.query || {}) }, entetes: safeHeaders(req.headers), ip: clientIp(req), methode: m, point: nom };
    /* Avec quels droits ? Par défaut ceux d'un visiteur (public). Pour écrire dans des
       tables protégées, le point peut agir au nom d'un compte précis (ex. un compte « robot »). */
    const out = await wf.runWithoutRow({ row: ctx, req, user: await runAs(p.executer_en) });
    const key = String(p.reponse || "").trim();
    const val = key ? (out || {})[key] : { ok: true };
    const status = out && Number.isInteger(out.statut_http) && out.statut_http >= 200 && out.statut_http < 600 ? out.statut_http : 200;
    record(nom, true, Date.now() - t0);
    return reply(res, status, val === undefined ? null : val);
  } catch (e) {
    record(nom, false, Date.now() - t0, e.message);
    return reply(res, 500, { erreur: "erreur interne" });
  }
};

/* dans les métriques et le journal comme un bloc « api:<nom> » */
const record = (nom, ok, ms, message) => {
  try {
    const { journal } = require("./engine");
    if (!ok) journal({ bloc: `api:${nom}`, ok: false, duree_ms: ms, message });
  } catch (e) { /* rien */ }
};

module.exports = { handle, forget, NOM_RE, AUTHS, METHODES };
