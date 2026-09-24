/* Surveillance avancée : ce qu'Uptime Kuma ne fait pas (ou mal).
   Scénarios d'API avec vérifications, expiration de domaine (RDAP), listes
   noires (DNSBL), changement de contenu, changement DNS, métriques Prometheus,
   note de sécurité globale d'un site. */
"use strict";
const dns = require("dns").promises;
const crypto = require("crypto");
const { getPath, deep } = require("../engine");
const { plain } = require("../core");

const now = () => Number(process.hrtime.bigint() / 1000000n);
const kv = () => require("./controle").kv;
const fetchT = async (url, opt = {}, ms = 15000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ctl.signal }); } catch (e) { throw new Error(e.name === "AbortError" ? `délai dépassé (${Math.round(ms / 1000)} s)` : e.message); } finally { clearTimeout(t); }
};

/* une vérification : { chemin: "data.status", egal | contient | existe | max | min | regex } */
const check = (val, a) => {
  if (a.existe !== undefined) return (val !== undefined && val !== null) === !!a.existe;
  if (a.egal !== undefined) return JSON.stringify(val) === JSON.stringify(a.egal) || String(val) === String(a.egal);
  if (a.contient !== undefined) return String(typeof val === "object" ? JSON.stringify(val) : val).includes(String(a.contient));
  if (a.regex !== undefined) return new RegExp(a.regex).test(String(val));
  if (a.max !== undefined) return Number(val) <= Number(a.max);
  if (a.min !== undefined) return Number(val) >= Number(a.min);
  return true;
};

module.exports = [
  {
    name: "dzf_api_scenario", label: "Surveillance : scénario d'API", category: "Surveillance", icon: "fas fa-route", output: "scenario", timeout: 120,
    description: "Enchaîne plusieurs appels HTTP comme un vrai utilisateur (connexion → action → vérification), avec des vérifications sur le code, le temps et le contenu JSON, et des valeurs reprises d'un appel à l'autre ({{login.token}}).",
    params: [
      { name: "etapes", label: "Étapes (JSON)", type: "json", raw: true, required: true, default: '[{"nom":"sante","url":"https://exemple.fr/api/health","attendu":{"statut":200,"max_ms":1500,"verifs":[{"chemin":"status","egal":"ok"}]}}]', help: 'Chaque étape : nom, url, methode, entetes, corps, attendu {statut, max_ms, verifs:[{chemin, egal|contient|existe|regex|min|max}]}. Les réponses sont réutilisables : {{nom_etape.champ}}' },
      { name: "secret_entete", label: "Secret ajouté en Authorization (facultatif)", help: "Nom d'un secret du coffre ; envoyé en « Bearer … »" },
    ],
    run: async (p, ctx, api) => {
      let steps = p.etapes;
      if (typeof steps === "string") steps = JSON.parse(steps);
      const auth = p.secret_entete ? await api.secret(p.secret_entete) : "";
      const vars = { ...ctx };
      const res = [];
      const t0 = now();
      for (const s of steps || []) {
        const e = deep(s, vars);
        const a = e.attendu || {};
        const t1 = now();
        let r, body, json = null, err = "";
        try {
          r = await fetchT(e.url, { method: e.methode || (e.corps ? "POST" : "GET"), headers: { "User-Agent": "dysizz-flow-monitor/2", ...(e.corps && typeof e.corps === "object" ? { "Content-Type": "application/json" } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(e.entetes || {}) }, body: e.corps ? (typeof e.corps === "object" ? JSON.stringify(e.corps) : String(e.corps)) : undefined }, (a.delai_s || 15) * 1000);
          body = await r.text();
          try { json = JSON.parse(body); } catch (x) { json = null; }
        } catch (x) { err = x.message; }
        const ms = now() - t1;
        const fails = [];
        if (err) fails.push(err);
        else {
          if (a.statut && r.status !== +a.statut) fails.push(`code ${r.status} au lieu de ${a.statut}`);
          if (!a.statut && r.status >= 400) fails.push(`code ${r.status}`);
          if (a.max_ms && ms > +a.max_ms) fails.push(`${ms} ms > ${a.max_ms} ms`);
          if (a.contient && !String(body).includes(a.contient)) fails.push(`texte « ${a.contient} » absent`);
          for (const v of a.verifs || []) if (!check(getPath(json, v.chemin), v)) fails.push(`${v.chemin} : ${JSON.stringify(getPath(json, v.chemin))} ne va pas`);
        }
        vars[e.nom || `etape${res.length + 1}`] = json !== null ? json : body;
        res.push({ nom: e.nom, url: e.url, statut: r ? r.status : 0, ms, ok: !fails.length, raison: fails.join(" ; ") });
        if (fails.length && e.stop !== false) break;
      }
      const bad = res.find((x) => !x.ok);
      return { ok: !bad, etat: bad ? "panne" : "ok", ms: now() - t0, raison: bad ? `${bad.nom || "étape"} : ${bad.raison}` : "", etapes: res };
    },
  },
  {
    name: "dzf_domaine_expiration", label: "Surveillance : expiration du nom de domaine", category: "Surveillance", icon: "fas fa-globe", output: "domaine", timeout: 30,
    description: "Lit la date d'expiration d'un nom de domaine (protocole RDAP, successeur de WHOIS) et le bureau d'enregistrement. Un domaine qui expire, c'est tout qui tombe : site, mails…",
    params: [{ name: "domaine", label: "Domaine", required: true, help: "Ex. ambs-agency.com" }, { name: "alerte_jours", label: "Attention en dessous de (jours)", type: "int", default: 30 }],
    run: async (p) => {
      const d = String(p.domaine).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim().toLowerCase();
      const r = await fetchT(`https://rdap.org/domain/${encodeURIComponent(d)}`, { headers: { Accept: "application/rdap+json, application/json" }, redirect: "follow" }, 20000);
      if (!r.ok) throw new Error(`RDAP : HTTP ${r.status}`);
      const j = await r.json();
      const ev = (name) => ((j.events || []).find((e) => e.eventAction === name) || {}).eventDate || null;
      const exp = ev("expiration");
      const reg = ((j.entities || []).find((e) => (e.roles || []).includes("registrar")) || {});
      const regName = ((reg.vcardArray || [])[1] || []).find((x) => x[0] === "fn");
      const jours = exp ? Math.floor((new Date(exp) - Date.now()) / 864e5) : null;
      return { domaine: d, expiration: exp, jours_restants: jours, cree_le: ev("registration"), registrar: regName ? regName[3] : "", statuts: j.status || [], etat: jours === null ? "inconnu" : jours < 0 ? "panne" : jours <= (+p.alerte_jours || 30) ? "lent" : "ok" };
    },
  },
  {
    name: "dzf_liste_noire", label: "Sécurité : IP ou domaine sur liste noire ?", category: "Sécurité", icon: "fas fa-ban", output: "liste_noire", timeout: 40,
    description: "Vérifie si l'adresse IP d'un serveur (ou d'un domaine) est sur les listes noires anti-spam (Spamhaus, SpamCop, Barracuda…). Si oui, tes mails finissent en spam.",
    params: [{ name: "cible", label: "IP ou domaine", required: true }, { name: "listes", label: "Listes (DNSBL)", default: "zen.spamhaus.org,bl.spamcop.net,b.barracudacentral.org,dnsbl.sorbs.net,psbl.surriel.com" }],
    run: async (p) => {
      let ip = String(p.cible).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) ip = (await dns.resolve4(ip))[0];
      const rev = ip.split(".").reverse().join(".");
      const listes = String(p.listes).split(",").map((s) => s.trim()).filter(Boolean);
      const res = await Promise.all(listes.map(async (l) => {
        try { const a = await dns.resolve4(`${rev}.${l}`); return { liste: l, liste_noire: !a.some((x) => /^127\.255\./.test(x)), code: a.join(",") }; } catch (e) { return { liste: l, liste_noire: false, code: e.code === "ENOTFOUND" || e.code === "ENODATA" ? "" : e.code }; }
      }));
      const hits = res.filter((x) => x.liste_noire);
      return { ip, sur_liste: hits.map((x) => x.liste), details: res, etat: hits.length ? "panne" : "ok", raison: hits.length ? `listée sur ${hits.map((x) => x.liste).join(", ")}` : "" };
    },
  },
  {
    name: "dzf_contenu_change", label: "Surveillance : la page a-t-elle changé ?", category: "Surveillance", icon: "fas fa-not-equal", output: "changement", timeout: 60,
    description: "Lit une page (ou une partie entre deux repères) et dit si son texte a changé depuis la dernière fois : prix, CGU, offre d'emploi, défiguration de ton site… Garde une empreinte, pas la page.",
    params: [
      { name: "url", label: "Adresse", required: true }, { name: "debut", label: "Repère de début (facultatif)", help: "Texte à partir duquel comparer" },
      { name: "fin", label: "Repère de fin (facultatif)" }, { name: "ignorer", label: "Ignorer (regex, facultatif)", help: "Ex. \\d{2}:\\d{2} pour ignorer les heures" },
    ],
    run: async (p) => {
      const r = await fetchT(p.url, { headers: { "User-Agent": "Mozilla/5.0 (dysizz-flow)" }, redirect: "follow" }, 20000);
      let t = plain(await r.text());
      if (p.debut) { const i = t.indexOf(p.debut); if (i >= 0) t = t.slice(i); }
      if (p.fin) { const i = t.indexOf(p.fin); if (i >= 0) t = t.slice(0, i + p.fin.length); }
      if (p.ignorer) t = t.replace(new RegExp(p.ignorer, "g"), "");
      t = t.replace(/\s+/g, " ").trim();
      const h = crypto.createHash("sha256").update(t).digest("hex");
      const k = `dzf:page:${crypto.createHash("sha1").update(`${p.url}|${p.debut}|${p.fin}`).digest("hex")}`;
      const prev = await kv().get(k);
      await kv().set(k, { h, extrait: t.slice(0, 2000), quand: Date.now() }, 400 * 86400);
      const change = !!(prev && prev.h !== h);
      let apercu = "";
      if (change) { let i = 0; while (i < prev.extrait.length && prev.extrait[i] === t[i]) i++; apercu = `…${t.slice(Math.max(0, i - 60), i + 140)}…`; }
      return { change, premiere_fois: !prev, statut: r.status, longueur: t.length, apercu, etat: change ? "lent" : "ok", raison: change ? "contenu modifié" : "" };
    },
  },
  {
    name: "dzf_dns_changement", label: "Surveillance : le DNS a-t-il changé ?", category: "Surveillance", icon: "fas fa-exchange-alt", output: "dns_change", timeout: 30,
    description: "Compare les enregistrements DNS d'un domaine (A, AAAA, MX, NS, TXT, CNAME) avec la dernière lecture. Un changement que tu n'as pas fait peut être un détournement.",
    params: [{ name: "domaine", label: "Domaine", required: true }, { name: "types", label: "Types", default: "A,AAAA,MX,NS,TXT" }],
    run: async (p) => {
      const d = String(p.domaine).replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
      const cur = {};
      for (const t of String(p.types).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) {
        try { cur[t] = (await dns.resolve(d, t)).map((x) => (typeof x === "object" ? (Array.isArray(x) ? x.join("") : x.exchange ? `${x.priority} ${x.exchange}` : JSON.stringify(x)) : x)).sort(); } catch (e) { cur[t] = []; }
      }
      const k = `dzf:dns:${d}`;
      const prev = await kv().get(k);
      await kv().set(k, cur, 400 * 86400);
      const diffs = prev ? Object.keys(cur).filter((t) => JSON.stringify(prev[t] || []) !== JSON.stringify(cur[t])).map((t) => `${t} : ${(prev[t] || []).join(", ") || "∅"} → ${cur[t].join(", ") || "∅"}`) : [];
      return { domaine: d, enregistrements: cur, change: diffs.length > 0, differences: diffs, etat: diffs.length ? "lent" : "ok", raison: diffs.join(" ; ") };
    },
  },
  {
    name: "dzf_prometheus", label: "Métriques : lire Prometheus", category: "Logs & métriques", icon: "fas fa-fire", output: "prometheus", timeout: 30,
    description: "Pose une requête PromQL à Prometheus (ou VictoriaMetrics), ou lit directement une page /metrics, et compare la valeur à un seuil. Pour surveiller CPU, mémoire, files, erreurs 5xx de n'importe quel service.",
    params: [
      { name: "url", label: "Adresse", required: true, help: "Prometheus : http://prometheus:9090 — ou une page /metrics : http://service:9100/metrics" },
      { name: "requete", label: "Requête PromQL ou nom de métrique", required: true, help: 'Ex. 100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))*100 — ou pour /metrics : node_load1' },
      { name: "max", label: "Alerte au-dessus de", type: "number" }, { name: "min", label: "Alerte en dessous de", type: "number" }, { name: "secret_auth", label: "Secret user:motdepasse (facultatif)" },
    ],
    run: async (p, ctx, api) => {
      const headers = {};
      if (p.secret_auth) headers.Authorization = `Basic ${Buffer.from((await api.secret(p.secret_auth)) || "").toString("base64")}`;
      let v;
      if (/\/metrics\/?$/.test(p.url)) {
        const txt = await (await fetchT(p.url, { headers })).text();
        const line = txt.split("\n").find((l) => !l.startsWith("#") && (l.startsWith(`${p.requete} `) || l.startsWith(`${p.requete}{`)));
        if (!line) throw new Error(`métrique ${p.requete} absente`);
        v = Number(line.trim().split(/\s+/).pop());
      } else {
        const r = await fetchT(`${String(p.url).replace(/\/$/, "")}/api/v1/query?query=${encodeURIComponent(p.requete)}`, { headers });
        const j = await r.json();
        if (j.status !== "success") throw new Error(`Prometheus : ${j.error || r.status}`);
        const res = j.data.result || [];
        v = res.length ? Number((res[0].value || [])[1]) : null;
      }
      const over = p.max !== undefined && p.max !== "" && v > +p.max, under = p.min !== undefined && p.min !== "" && v < +p.min;
      return { valeur: v, etat: over || under ? "panne" : "ok", raison: over ? `${v} > ${p.max}` : under ? `${v} < ${p.min}` : "" };
    },
  },
  {
    name: "dzf_note_securite", label: "Sécurité : note globale d'un site", category: "Sécurité", icon: "fas fa-user-shield", output: "note", timeout: 150,
    description: "Audit rapide d'un site, noté de A à F : en-têtes de sécurité, certificat TLS, ports ouverts inattendus, SPF / DMARC du domaine, liste noire. Avec la liste des points à corriger.",
    params: [{ name: "url", label: "Site", required: true, help: "Ex. https://monsite.fr" }, { name: "ports_attendus", label: "Ports normaux", default: "80,443" }],
    run: async (p, ctx, api) => {
      const B = (n) => module.exports.concat(require("./securite")).find((b) => b.name === n);
      const u = new URL(/^https?:/.test(p.url) ? p.url : `https://${p.url}`);
      const host = u.hostname, dom = host.split(".").slice(-2).join(".");
      const safe = async (n, q) => { try { return await B(n).run(q, ctx, api); } catch (e) { return { erreur: e.message }; } };
      const [ent, tls, ports, mail, bl] = await Promise.all([
        safe("dzf_entetes_securite", { url: u.href }), safe("dzf_certificat_tls", { hotes: host, port: 443 }),
        safe("dzf_ports", { hote: host, ports: "21,22,23,25,80,443,3000,3306,5432,6379,8080,8443,9000,9200,27017", delai_ms: 1500 }),
        safe("dzf_dns_mail", { domaine: dom }), safe("dzf_liste_noire", { cible: host }),
      ]);
      let score = 100; const points = [];
      const minus = (n, why) => { score -= n; points.push(why); };
      if (ent.erreur) minus(20, `site injoignable : ${ent.erreur}`);
      else { if (ent.score !== undefined) score -= Math.round((100 - ent.score) * 0.35); for (const m of ent.manque || []) points.push(`en-tête manquant : ${m}`); if (!ent.https) minus(15, "pas de HTTPS"); }
      if (tls.erreur) minus(15, `TLS : ${tls.erreur}`); else { if (tls.jours_restants !== null && tls.jours_restants < 14) minus(10, `certificat expire dans ${tls.jours_restants} j`); if (tls.valide === false) minus(20, `certificat invalide ${tls.erreur || ""}`); if (/TLSv1(\.0|\.1)?$/.test(tls.protocole || "")) minus(10, `protocole ancien ${tls.protocole}`); }
      const okPorts = String(p.ports_attendus).split(",").map((x) => +x);
      const extra = (ports.ouverts || []).filter((x) => !okPorts.includes(x));
      if (extra.length) minus(Math.min(30, extra.length * 10), `ports ouverts à vérifier : ${extra.join(", ")}`);
      if (!mail.erreur) for (const c of mail.conseils || []) minus(3, `mail : ${c}`);
      if ((bl.sur_liste || []).length) minus(20, `IP sur liste noire : ${bl.sur_liste.join(", ")}`);
      score = Math.max(0, Math.min(100, score));
      const note = score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : score >= 35 ? "E" : "F";
      return { site: u.href, note, score, a_corriger: points, details: { entetes: ent, tls, ports, mail, liste_noire: bl }, etat: score >= 65 ? "ok" : score >= 50 ? "lent" : "panne", raison: points.slice(0, 3).join(" ; ") };
    },
  },
];
