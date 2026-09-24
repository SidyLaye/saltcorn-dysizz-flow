/* Blocs « Surveillance » : savoir si tes sites, serveurs et bases vont bien,
   avant que quelqu'un ne te le dise. */
"use strict";
const os = require("os");
const fs = require("fs");
const dns = require("dns").promises;
const { asList, pool } = require("../engine");

const now = () => Number(process.hrtime.bigint() / 1000000n);

const pingOne = async (target, p) => {
  const url = typeof target === "string" ? target : target.url;
  const t0 = now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (+p.delai_s || 10) * 1000);
    const r = await fetch(url, { method: p.methode || "GET", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "dysizz-flow-monitor/1.0" } });
    const body = p.contient ? await r.text() : "";
    clearTimeout(timer);
    const ms = now() - t0;
    const okStatus = String(p.codes_ok || "200-399").split(",").some((rg) => { const [a, b] = rg.split("-").map(Number); return r.status >= a && r.status <= (b || a); });
    const okBody = !p.contient || body.includes(p.contient);
    const lent = p.lent_ms && ms > +p.lent_ms;
    return { ...(typeof target === "object" ? target : {}), url, statut: r.status, ms, ok: okStatus && okBody, lent: !!lent, etat: !okStatus || !okBody ? "panne" : lent ? "lent" : "ok", raison: !okStatus ? `code ${r.status}` : !okBody ? "texte attendu absent" : lent ? `lent (${ms} ms)` : "" };
  } catch (e) {
    return { ...(typeof target === "object" ? target : {}), url, statut: 0, ms: now() - t0, ok: false, lent: false, etat: "panne", raison: e.name === "AbortError" ? "délai dépassé" : e.message };
  }
};

module.exports = [
  {
    name: "dzf_ping_http", label: "Surveillance : site en ligne ?", category: "Surveillance", icon: "fas fa-heartbeat", output: "sites", timeout: 120,
    description: "Appelle une ou plusieurs adresses en parallèle : code HTTP, temps de réponse, texte attendu. Chaque résultat dit « ok », « lent » ou « panne » avec la raison.",
    params: [{ name: "cibles", label: "Adresses", required: true, help: "Une adresse, plusieurs séparées par des virgules, ou une liste {{sites}} (champ url)" },
      { name: "codes_ok", label: "Codes acceptés", default: "200-399" }, { name: "contient", label: "Texte qui doit être dans la page (facultatif)" },
      { name: "lent_ms", label: "Lent au-delà de (ms)", type: "int", default: 2000 }, { name: "delai_s", label: "Abandon après (secondes)", type: "int", default: 10 },
      { name: "en_parallele", label: "En même temps", type: "int", default: 8 }],
    run: async (p) => {
      const list = Array.isArray(p.cibles) ? p.cibles : String(p.cibles).split(",").map((s) => s.trim()).filter(Boolean);
      const r = await pool(list, +p.en_parallele || 8, (t) => pingOne(t, p));
      return Array.isArray(p.cibles) || list.length > 1 ? r : r[0];
    },
  },
  {
    name: "dzf_dns", label: "Surveillance : résolution DNS", category: "Surveillance", icon: "fas fa-sitemap", output: "dns",
    description: "Interroge le DNS d'un domaine (A, AAAA, CNAME, MX, TXT, NS). Pour vérifier qu'un domaine pointe au bon endroit.",
    params: [{ name: "domaine", label: "Domaine", required: true }, { name: "type", label: "Type", type: "select", options: ["A", "AAAA", "CNAME", "MX", "TXT", "NS"], default: "A" },
      { name: "attendu", label: "Valeur attendue (facultatif)", help: "Ex. l'IP de ton serveur : le résultat dit si elle est présente" }],
    run: async (p) => {
      const valeurs = (await dns.resolve(p.domaine, p.type).catch((e) => { throw new Error(`${p.domaine} : ${e.code || e.message}`); })).map((x) => (typeof x === "object" ? (Array.isArray(x) ? x.join("") : x.exchange || JSON.stringify(x)) : x));
      return { domaine: p.domaine, type: p.type, valeurs, ok: !p.attendu || valeurs.includes(p.attendu) };
    },
  },
  {
    name: "dzf_port_ouvert", label: "Surveillance : service joignable (TCP)", category: "Surveillance", icon: "fas fa-plug", output: "tcp",
    description: "Vérifie qu'un service répond sur un port (base de données, SMTP, SSH, Redis…) et mesure le temps de connexion.",
    params: [{ name: "hote", label: "Serveur", required: true }, { name: "port", label: "Port", type: "int", required: true }, { name: "delai_ms", label: "Abandon après (ms)", type: "int", default: 3000 }],
    run: async (p) => {
      const net = require("net");
      const t0 = now();
      return new Promise((res) => {
        const s = net.createConnection({ host: p.hote, port: +p.port, timeout: +p.delai_ms || 3000 });
        const done = (ok, raison) => { s.destroy(); res({ hote: p.hote, port: +p.port, ok, ms: now() - t0, raison: raison || "" }); };
        s.on("connect", () => done(true)); s.on("timeout", () => done(false, "délai dépassé")); s.on("error", (e) => done(false, e.code || e.message));
      });
    },
  },
  {
    name: "dzf_sante_serveur", label: "Surveillance : santé du serveur Saltcorn", category: "Surveillance", icon: "fas fa-server", output: "serveur",
    description: "Charge CPU, mémoire, disque, temps de fonctionnement du conteneur Saltcorn qui exécute le workflow. Avec des seuils qui disent si ça va.",
    params: [{ name: "chemin_disque", label: "Disque à mesurer", default: "/" }, { name: "seuil_disque", label: "Alerte disque au-delà de (%)", type: "int", default: 85 },
      { name: "seuil_memoire", label: "Alerte mémoire au-delà de (%)", type: "int", default: 90 }],
    run: async (p) => {
      const mem = 100 - Math.round((os.freemem() / os.totalmem()) * 100);
      let disque = null;
      try { const st = fs.statfsSync(p.chemin_disque || "/"); disque = 100 - Math.round((st.bavail / st.blocks) * 100); } catch (e) { disque = null; }
      const charge = os.loadavg()[0];
      const alertes = [];
      if (disque !== null && disque > (+p.seuil_disque || 85)) alertes.push(`disque à ${disque} %`);
      if (mem > (+p.seuil_memoire || 90)) alertes.push(`mémoire à ${mem} %`);
      if (charge > os.cpus().length * 1.5) alertes.push(`charge CPU ${charge.toFixed(2)}`);
      return { hote: os.hostname(), cpu: os.cpus().length, charge_1min: +charge.toFixed(2), memoire_pct: mem, disque_pct: disque, process_mo: Math.round(process.memoryUsage().rss / 1048576), uptime_h: +(os.uptime() / 3600).toFixed(1), node: process.version, ok: !alertes.length, alertes };
    },
  },
  {
    name: "dzf_sante_postgres", label: "Surveillance : santé de Postgres", category: "Surveillance", icon: "fas fa-database", output: "postgres",
    description: "Connexions ouvertes (et le maximum), taille de la base, requêtes qui tournent depuis longtemps, verrous en attente. Lecture seule.",
    params: [{ name: "requete_longue_s", label: "Requête longue au-delà de (secondes)", type: "int", default: 30 }],
    run: async (p) => {
      const db = require("@saltcorn/data/db");
      if (db.isSQLite) return { ok: true, info: "SQLite : rien à mesurer" };
      const one = async (sql, v = []) => (await db.query(sql, v)).rows;
      const [c] = await one("select count(*)::int as n, (select setting::int from pg_settings where name='max_connections') as max from pg_stat_activity");
      const [t] = await one("select pg_database_size(current_database())::bigint as octets");
      const longues = await one("select pid, now() - query_start as duree, left(query, 200) as requete, state from pg_stat_activity where state <> 'idle' and query_start < now() - ($1 || ' seconds')::interval and pid <> pg_backend_pid() order by query_start limit 10", [String(+p.requete_longue_s || 30)]);
      const [v] = await one("select count(*)::int as n from pg_locks where not granted");
      const pct = Math.round((c.n / c.max) * 100);
      return { connexions: c.n, max_connexions: c.max, connexions_pct: pct, taille_mo: Math.round(Number(t.octets) / 1048576), requetes_longues: longues.map((r) => ({ ...r, duree: String(r.duree) })), verrous_en_attente: v.n, ok: pct < 80 && !longues.length && v.n === 0 };
    },
  },
  {
    name: "dzf_battement", label: "Surveillance : battement de cœur", category: "Surveillance", icon: "fas fa-signal", output: "battement",
    description: "Prévient un service de surveillance externe (Uptime Kuma « push », Healthchecks, Better Stack…) que le workflow a bien tourné. S'il ne reçoit plus rien, c'est lui qui t'alerte.",
    params: [{ name: "url", label: "Adresse de push", required: true, help: "Ex. https://status.mondomaine/api/push/XXXX?status=up&msg=OK" }, { name: "message", label: "Message", default: "OK" }],
    run: async (p) => {
      const u = new URL(p.url);
      if (p.message && !u.searchParams.has("msg")) u.searchParams.set("msg", p.message);
      const r = await fetch(u, { method: "GET" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    },
  },
  {
    name: "dzf_workflows_etat", label: "Surveillance : état des workflows", category: "Surveillance", icon: "fas fa-project-diagram", output: "workflows",
    description: "Compte les exécutions de workflows Saltcorn des dernières heures, par statut, et liste les dernières en erreur. Pour surveiller ta propre automatisation.",
    params: [{ name: "heures", label: "Sur les N dernières heures", type: "int", default: 24 }],
    run: async (p) => {
      const db = require("@saltcorn/data/db");
      const since = new Date(Date.now() - (+p.heures || 24) * 3600e3);
      const WR = require("@saltcorn/data/models/workflow_run");
      const runs = await WR.find({ started_at: { gt: since } }, { orderBy: "id", orderDesc: true, limit: 2000 }).catch(() => []);
      const Trigger = require("@saltcorn/data/models/trigger");
      const par = {};
      for (const r of runs) par[r.status] = (par[r.status] || 0) + 1;
      const erreurs = runs.filter((r) => r.status === "Error").slice(0, 20).map((r) => ({ id: r.id, workflow: (Trigger.findOne({ id: r.trigger_id }) || {}).name, quand: r.started_at, erreur: String(r.error || "").slice(0, 300) }));
      void db;
      return { total: runs.length, par_statut: par, erreurs, ok: !erreurs.length };
    },
  },
];
