/* Blocs « Contrôle » : pause, vérification, verrou, cache, limite de débit,
   Redis, journal, code libre. De quoi tenir la charge proprement. */
"use strict";
const redis = require("../lib/redis");
const { ensureTables } = require("../store");

const ttlDate = (s) => new Date(Date.now() + Math.max(1, +s || 60) * 1000);

/* ---- cache et compteurs : Redis s'il est configuré (REDIS_URL), sinon une table ---- */
const kv = {
  async get(k) {
    if (redis.available()) { const v = await redis.cmd(["GET", k]); return v === null ? null : JSON.parse(v); }
    const { cache } = await ensureTables();
    const r = await cache.getRow({ cle: k });
    if (!r || (r.expire && new Date(r.expire) < new Date())) return null;
    return JSON.parse(r.valeur);
  },
  async set(k, v, ttl) {
    const s = JSON.stringify(v);
    if (redis.available()) return redis.cmd(ttl ? ["SET", k, s, "EX", String(+ttl)] : ["SET", k, s]);
    const { cache } = await ensureTables();
    const r = await cache.getRow({ cle: k });
    const row = { cle: k, valeur: s, expire: ttl ? ttlDate(ttl) : null };
    if (r) await cache.updateRow(row, r.id); else await cache.insertRow(row);
  },
  async del(k) {
    if (redis.available()) return redis.cmd(["DEL", k]);
    const { cache } = await ensureTables();
    await cache.deleteRows({ cle: k });
  },
  async incr(k, ttl) {
    if (redis.available()) {
      const n = await redis.cmd(["INCR", k]);
      if (n === 1 && ttl) await redis.cmd(["EXPIRE", k, String(+ttl)]);
      return n;
    }
    const cur = (await kv.get(k)) || 0;
    await kv.set(k, cur + 1, ttl);
    return cur + 1;
  },
};

module.exports = [
  {
    name: "dzf_pause", label: "Pause", category: "Contrôle", icon: "fas fa-hourglass-half", output: "pause",
    description: "Attend quelques secondes (ex. pour respecter la limite d'une API). Pour attendre des heures, utilise l'étape native « WaitUntil ».",
    params: [{ name: "secondes", label: "Secondes", type: "number", default: 1 }],
    run: async (p) => { const s = Math.min(Math.max(0, +p.secondes || 0), 25); await new Promise((r) => setTimeout(r, s * 1000)); return s; },
  },
  {
    name: "dzf_verifier", label: "Vérifier une condition", category: "Contrôle", icon: "fas fa-check-double", output: "verifie",
    description: "Calcule une condition. Soit le workflow s'arrête en erreur si elle est fausse, soit tu récupères vrai/faux pour choisir l'étape suivante.",
    params: [{ name: "condition", label: "Condition (JavaScript sur le contexte)", required: true, raw: true, help: "Ex. ctx.lignes.length > 0 && ctx.total < 100" },
      { name: "si_faux", label: "Si c'est faux", type: "select", options: ["renvoyer faux", "arrêter en erreur"], default: "renvoyer faux" }, { name: "message", label: "Message d'erreur", default: "Condition non remplie" }],
    run: async (p, ctx) => {
      let ok;
      try { ok = !!new Function("ctx", `"use strict"; return (${p.condition});`)(ctx); } catch (e) { throw new Error(`condition invalide : ${e.message}`); }
      if (!ok && p.si_faux === "arrêter en erreur") throw new Error(p.message || "Condition non remplie");
      return ok;
    },
  },
  {
    name: "dzf_verrou", label: "Verrou (une exécution à la fois)", category: "Contrôle", icon: "fas fa-lock", output: "verrou",
    description: "Empêche deux exécutions du même travail en même temps, même avec plusieurs serveurs. « prendre » renvoie vrai si tu as le verrou ; pense à « libérer » à la fin (il expire seul sinon).",
    params: [{ name: "action", label: "Action", type: "select", options: ["prendre", "libérer"], default: "prendre" }, { name: "nom", label: "Nom du verrou", required: true, help: "Ex. releve-mails" },
      { name: "duree", label: "Expire après (secondes)", type: "int", default: 600 }],
    run: async (p) => {
      const key = `dzf:verrou:${p.nom}`;
      if (redis.available()) {
        if (p.action === "libérer") { await redis.cmd(["DEL", key]); return true; }
        return (await redis.cmd(["SET", key, String(process.pid), "NX", "EX", String(+p.duree || 600)])) === "OK";
      }
      const { verrous } = await ensureTables();
      if (p.action === "libérer") { await verrous.deleteRows({ nom: p.nom }); return true; }
      const now = new Date();
      await verrous.deleteRows({ nom: p.nom, jusqu_a: { lt: now } });
      try { await verrous.insertRow({ nom: p.nom, jusqu_a: ttlDate(p.duree || 600), par: `${require("os").hostname()}:${process.pid}` }); return true; } catch (e) { return false; }
    },
  },
  {
    name: "dzf_cache", label: "Cache : lire / écrire", category: "Contrôle", icon: "fas fa-database", output: "cache",
    description: "Garde une valeur un moment pour éviter de rappeler une API ou de refaire un calcul. Utilise Redis si REDIS_URL est défini, sinon une table.",
    params: [{ name: "action", label: "Action", type: "select", options: ["lire", "écrire", "supprimer"], default: "lire" }, { name: "cle", label: "Clé", required: true },
      { name: "valeur", label: "Valeur (pour écrire)", help: "Ex. {{http.data}}" }, { name: "ttl", label: "Durée (secondes)", type: "int", default: 3600 }],
    run: async (p) => {
      const k = `dzf:cache:${p.cle}`;
      if (p.action === "écrire") { await kv.set(k, p.valeur ?? null, p.ttl); return p.valeur ?? null; }
      if (p.action === "supprimer") { await kv.del(k); return null; }
      return kv.get(k);
    },
  },
  {
    name: "dzf_limiter", label: "Limiter le débit", category: "Contrôle", icon: "fas fa-tachometer-alt", output: "limite",
    description: "Compte les passages sur une fenêtre de temps. Renvoie {autorise, compte}. Ex. pas plus de 50 messages WhatsApp par heure.",
    params: [{ name: "cle", label: "Clé", required: true, help: "Ex. whatsapp-{{user.id}}" }, { name: "max", label: "Max par fenêtre", type: "int", default: 60 },
      { name: "fenetre", label: "Fenêtre (secondes)", type: "int", default: 3600 }, { name: "bloquer", label: "Arrêter en erreur si dépassé", type: "bool" }],
    run: async (p) => {
      const n = await kv.incr(`dzf:rl:${p.cle}:${Math.floor(Date.now() / 1000 / (+p.fenetre || 3600))}`, +p.fenetre || 3600);
      const ok = n <= (+p.max || 60);
      if (!ok && p.bloquer) throw new Error(`limite atteinte (${n}/${p.max})`);
      return { autorise: ok, compte: n };
    },
  },
  {
    name: "dzf_redis", label: "Redis : commande", category: "Contrôle", icon: "fas fa-server", output: "redis",
    description: "Parle directement à ton Redis (REDIS_URL) : GET, SET, INCR, LPUSH/RPOP pour faire une file d'attente, PUBLISH…",
    params: [{ name: "commande", label: "Commande", type: "select", options: ["GET", "SET", "DEL", "INCR", "EXPIRE", "LPUSH", "RPOP", "LLEN", "PUBLISH"], default: "GET" },
      { name: "cle", label: "Clé (ou canal)", required: true }, { name: "valeur", label: "Valeur" }, { name: "ttl", label: "Expiration (secondes, pour SET)", type: "int" }],
    run: async (p) => {
      if (!redis.available()) throw new Error("REDIS_URL n'est pas défini sur le serveur");
      const v = p.valeur === undefined ? "" : typeof p.valeur === "string" ? p.valeur : JSON.stringify(p.valeur);
      const args = { GET: [p.cle], DEL: [p.cle], INCR: [p.cle], LLEN: [p.cle], RPOP: [p.cle], EXPIRE: [p.cle, String(+p.ttl || 60)], LPUSH: [p.cle, v], PUBLISH: [p.cle, v], SET: p.ttl ? [p.cle, v, "EX", String(+p.ttl)] : [p.cle, v] }[p.commande];
      const r = await redis.cmd([p.commande, ...args]);
      if (typeof r === "string") { try { return JSON.parse(r); } catch (e) { return r; } }
      return r;
    },
  },
  {
    name: "dzf_journal", label: "Écrire dans le journal", category: "Contrôle", icon: "fas fa-clipboard-list", output: "journal",
    description: "Laisse une trace lisible dans le journal de dysizz-flow (page Journal).",
    params: [{ name: "message", label: "Message", type: "text", required: true }, { name: "erreur", label: "C'est une erreur", type: "bool" }],
    run: async (p) => { const { journal } = await ensureTables(); await journal.insertRow({ quand: new Date(), bloc: "journal", ok: !p.erreur, duree_ms: 0, message: String(p.message).slice(0, 1000) }); return true; },
  },
  {
    name: "dzf_code", label: "Code JavaScript", category: "Contrôle", icon: "fas fa-terminal", output: "code", timeout: 60,
    description: "Ton propre code, exécuté dans le bac à sable de Saltcorn (Table, fetch, User, Notification… disponibles). Le contexte est dans « row » ; ce que tu renvoies va dans la sortie.",
    params: [{ name: "code", label: "Code", type: "code", required: true, raw: true, default: "// row = le contexte du workflow\nconst n = (row.lignes || []).length;\nreturn { nombre: n };" }],
    run: async (p, ctx, api) => {
      const { getState } = require("@saltcorn/data/db/state");
      const js = getState().actions.run_js_code;
      return js.run({ configuration: { code: p.code, run_where: "Server" }, row: ctx, user: api.user, req: api.req, mode: "workflow" });
    },
  },
];
module.exports.kv = kv;
