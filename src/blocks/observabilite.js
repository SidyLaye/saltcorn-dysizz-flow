/* Blocs « Logs & métriques » : garder une trace, compter, alerter sans spammer,
   envoyer vers un outil de logs (Loki, Better Stack, Elastic…). */
"use strict";
const { asList } = require("../engine");
const { ensureTables } = require("../store");

module.exports = [
  {
    name: "dzf_metrique", label: "Métrique : enregistrer une valeur", category: "Logs & métriques", icon: "fas fa-chart-line", output: "metrique",
    description: "Note une valeur datée (ex. temps de réponse, nombre de mails, solde) dans la table dzf_mesures, pour la suivre dans le temps et l'afficher en graphique (vue DZ Graphique de dysizz-ui).",
    params: [{ name: "nom", label: "Nom de la métrique", required: true, help: "Ex. site.web.ms" }, { name: "valeur", label: "Valeur (nombre)", required: true, help: "Ex. {{sites.ms}}" },
      { name: "etiquettes", label: "Étiquettes (JSON, facultatif)", type: "json", help: '{"serveur":"ovh-1"}' }],
    run: async (p) => {
      const T = await ensureTables();
      const v = Number(p.valeur);
      if (!Number.isFinite(v)) throw new Error("la valeur n'est pas un nombre");
      await T.mesures.insertRow({ quand: new Date(), nom: String(p.nom).slice(0, 120), valeur: v, etiquettes: p.etiquettes ? JSON.stringify(p.etiquettes) : "" });
      return v;
    },
  },
  {
    name: "dzf_metrique_lire", label: "Métrique : lire une période", category: "Logs & métriques", icon: "fas fa-chart-area", output: "stat",
    description: "Moyenne, min, max, dernière valeur et nombre de points d'une métrique sur les N dernières heures. Pour décider d'une alerte (ex. moyenne > 1500 ms).",
    params: [{ name: "nom", label: "Nom de la métrique", required: true }, { name: "heures", label: "Sur les N dernières heures", type: "int", default: 24 }],
    run: async (p) => {
      const T = await ensureTables();
      const where = { nom: p.nom, quand: { gt: new Date(Date.now() - (+p.heures || 24) * 3600e3) } };
      const r = await T.mesures.aggregationQuery({ moy: { field: "valeur", aggregate: "Avg" }, min: { field: "valeur", aggregate: "Min" }, max: { field: "valeur", aggregate: "Max" }, n: { field: "id", aggregate: "Count" } }, { where });
      const last = (await T.mesures.getRows(where, { orderBy: "quand", orderDesc: true, limit: 1 }))[0];
      return { nom: p.nom, moyenne: r && r.moy !== null ? +Number(r.moy).toFixed(3) : null, min: r ? r.min : null, max: r ? r.max : null, points: r ? Number(r.n) : 0, derniere: last ? last.valeur : null };
    },
  },
  {
    name: "dzf_alerte", label: "Alerte (sans spam)", category: "Logs & métriques", icon: "fas fa-bell-slash", output: "alerte",
    description: "Laisse passer une alerte une seule fois par période pour une même clé (ex. « site X en panne » toutes les 30 min, pas toutes les 5 min). Prévient aussi quand ça revient à la normale.",
    params: [{ name: "cle", label: "Clé de l'alerte", required: true, help: "Ex. panne-{{site.url}}" }, { name: "probleme", label: "Il y a un problème ?", help: "Oui si c'est vrai, un nombre > 0 ou une liste non vide. Ex. {{pannes}}" },
      { name: "silence_min", label: "Ne pas répéter avant (minutes)", type: "int", default: 30 }],
    run: async (p) => {
      const { kv } = require("./controle");
      const k = `dzf:alerte:${p.cle}`;
      const prev = await kv.get(k);
      const now = Date.now();
      /* oui si : vrai, un nombre > 0, une liste non vide (ex. {{pannes}}) */
      const pb = p.probleme;
      const bad = pb === true || pb === "true" || (typeof pb === "number" && pb > 0) || (/^\d+$/.test(String(pb)) && +pb > 0) || (Array.isArray(pb) && pb.length > 0);
      if (bad) {
        if (prev && prev.actif && now - prev.depuis_envoi < (+p.silence_min || 30) * 60e3) return { envoyer: false, etat: "déjà signalé", depuis: prev.debut };
        await kv.set(k, { actif: true, debut: (prev && prev.actif && prev.debut) || now, depuis_envoi: now }, 7 * 86400);
        return { envoyer: true, etat: prev && prev.actif ? "toujours en panne" : "nouveau problème", depuis: (prev && prev.actif && prev.debut) || now };
      }
      if (prev && prev.actif) { await kv.set(k, { actif: false }, 86400); return { envoyer: true, etat: "rétabli", duree_min: Math.round((now - prev.debut) / 60e3) }; }
      return { envoyer: false, etat: "ok" };
    },
  },
  {
    name: "dzf_logs_saltcorn", label: "Logs : événements et erreurs Saltcorn", category: "Logs & métriques", icon: "fas fa-scroll", output: "logs",
    description: "Lit le journal d'événements et le journal des plantages de Saltcorn (connexions, erreurs, déclencheurs…) des dernières heures.",
    params: [{ name: "source", label: "Journal", type: "select", options: ["erreurs", "événements"], default: "erreurs" }, { name: "heures", label: "Sur les N dernières heures", type: "int", default: 24 },
      { name: "contient", label: "Contient (facultatif)" }, { name: "limite", label: "Nombre max", type: "int", default: 100 }],
    run: async (p) => {
      const since = new Date(Date.now() - (+p.heures || 24) * 3600e3);
      const lim = Math.min(1000, +p.limite || 100);
      const has = (s) => !p.contient || String(s || "").toLowerCase().includes(String(p.contient).toLowerCase());
      if (p.source === "événements") {
        const EventLog = require("@saltcorn/data/models/eventlog");
        const ev = await EventLog.find({ occur_at: { gt: since } }, { orderBy: "id", orderDesc: true, limit: lim * 3 }).catch(() => []);
        return ev.filter((e) => has(JSON.stringify(e))).slice(0, lim).map((e) => ({ quand: e.occur_at, type: e.event_type, canal: e.channel, utilisateur: e.user_id, details: e.payload }));
      }
      const Crash = require("@saltcorn/data/models/crash");
      const cr = await Crash.find({ occur_at: { gt: since } }, { orderBy: "id", orderDesc: true, limit: lim * 3 }).catch(() => []);
      return cr.filter((c) => has(c.message + c.stack)).slice(0, lim).map((c) => ({ quand: c.occur_at, message: c.message, url: c.url, utilisateur: c.user_id, pile: String(c.stack || "").slice(0, 600) }));
    },
  },
  {
    name: "dzf_loki", label: "Logs : envoyer vers Loki / Grafana", category: "Logs & métriques", icon: "fas fa-stream", output: "loki",
    description: "Pousse une ou plusieurs lignes de log vers Grafana Loki (auto-hébergé ou cloud), avec des étiquettes. Le standard pour centraliser les logs de tous tes services.",
    params: [{ name: "url", label: "Adresse Loki", default: "http://loki:3100", help: "Sans /loki/api/v1/push" }, { name: "lignes", label: "Ligne(s)", required: true, help: "Un texte, ou une liste {{…}} (chaque élément devient une ligne JSON)" },
      { name: "etiquettes", label: "Étiquettes (JSON)", type: "json", default: '{"app":"saltcorn","source":"dysizz-flow"}' }, { name: "secret_auth", label: "Nom du secret user:motdepasse (facultatif)" }],
    run: async (p, ctx, api) => {
      const ns = () => `${Date.now()}000000`;
      const values = asList(p.lignes).map((l) => [ns(), typeof l === "string" ? l : JSON.stringify(l)]);
      const headers = { "Content-Type": "application/json" };
      if (p.secret_auth) headers.Authorization = `Basic ${Buffer.from(await api.secret(p.secret_auth) || "").toString("base64")}`;
      const r = await fetch(`${String(p.url).replace(/\/$/, "")}/loki/api/v1/push`, { method: "POST", headers, body: JSON.stringify({ streams: [{ stream: p.etiquettes || { app: "saltcorn" }, values }] }) });
      if (!r.ok) throw new Error(`Loki : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return values.length;
    },
  },
  {
    name: "dzf_nettoyer", label: "Maintenance : supprimer les vieilles lignes", category: "Logs & métriques", icon: "fas fa-broom", output: "nettoye",
    description: "Supprime les lignes plus vieilles que N jours d'une table (logs, mesures, historiques), par paquets pour ne pas bloquer la base.",
    params: [{ name: "table", label: "Table", type: "table", required: true }, { name: "champ_date", label: "Champ date", required: true, default: "quand" },
      { name: "jours", label: "Garder les N derniers jours", type: "int", default: 90 }, { name: "filtre", label: "Filtre en plus (JSON)", type: "json" }],
    run: async (p, ctx, api) => {
      const t = api.Table.findOne({ name: p.table });
      if (!t) throw new Error(`table « ${p.table} » introuvable`);
      if (api.user && api.user.role_id > t.min_role_write) throw new Error("écriture refusée pour ton rôle");
      const where = { ...(p.filtre || {}), [p.champ_date]: { lt: new Date(Date.now() - Math.max(1, +p.jours || 90) * 864e5) } };
      const n = await t.countRows(where);
      await t.deleteRows(where);
      return n;
    },
  },
];
