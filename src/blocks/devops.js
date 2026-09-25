/* DevOps : GitHub, GitLab, Docker, Dokploy, Kubernetes, Cloudflare, OVHcloud. */
"use strict";
const crypto = require("crypto");
const http = require("http");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const need = async (api, name) => { const v = await api.secret(name); if (!v) throw perm(`secret ${name} introuvable (variable d'environnement ou coffre)`); return v; };
const json = (v) => { if (v === undefined || v === null || v === "") return undefined; if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { throw perm("corps JSON invalide"); } } return v; };
const call = async (url, { method = "GET", headers = {}, body, name }) => {
  const r = await fetch(url, { method, headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) throw Object.assign(new Error(`${name} : HTTP ${r.status} ${(j && (j.message || j.error || (j.errors && JSON.stringify(j.errors)))) || String(t).slice(0, 200)}`), { permanent: [400, 401, 403, 404, 422].includes(r.status) });
  return j;
};

/* Docker : via le socket (monté en lecture) ou une adresse TCP */
const docker = (p, method, path, body) => new Promise((resolve, reject) => {
  const tcp = /^https?:\/\//.test(p.docker || "");
  const opt = tcp ? new URL(path, p.docker) : null;
  const req = (tcp && opt.protocol === "https:" ? require("https") : http).request(tcp ? { hostname: opt.hostname, port: opt.port, path: opt.pathname + opt.search, method } : { socketPath: p.docker || "/var/run/docker.sock", path, method }, (res) => {
    const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { const raw = Buffer.concat(parts); const d = path.includes("/logs") ? raw.toString("latin1") : raw.toString("utf8"); let j; try { j = d ? JSON.parse(d) : null; } catch (e) { j = d; } if (res.statusCode >= 400) reject(new Error(`Docker : ${res.statusCode} ${(j && j.message) || d.slice(0, 200)}`)); else resolve(j); });
  });
  req.on("error", (e) => reject(new Error(`Docker : ${e.message} (socket monté ? /var/run/docker.sock)`)));
  req.setHeader("Content-Type", "application/json");
  if (body) req.write(JSON.stringify(body));
  req.end();
});
/* journaux Docker : flux multiplexé (8 octets d'en-tête par morceau) */
const demux = (s) => { const b = Buffer.from(s, "latin1"); const out = []; let i = 0; while (i + 8 <= b.length && b[i] <= 2 && b[i + 1] === 0) { const n = b.readUInt32BE(i + 4); out.push(b.slice(i + 8, i + 8 + n).toString("utf8")); i += 8 + n; } return out.length ? out.join("") : b.toString("utf8"); };

module.exports = [
  {
    name: "dzf_github", label: "GitHub", category: "DevOps", icon: "fab fa-github", output: "github", timeout: 60,
    description: "Créer une issue, commenter, lister les issues ou pull requests, lire la dernière version publiée, lancer une GitHub Action, ou n'importe quel appel de l'API GitHub.",
    params: [{ name: "jeton", label: "Secret du jeton", default: "GITHUB_TOKEN" }, { name: "depot", label: "Dépôt", required: true, help: "propriétaire/nom, ex. SidyLaye/saltcorn-dysizz-flow" },
      { name: "action", label: "Action", type: "select", options: ["créer une issue", "commenter", "lister les issues", "lister les pull requests", "dernière version", "lancer une action", "appel libre"], default: "créer une issue" },
      { name: "titre", label: "Titre", showIf: { action: "créer une issue" } }, { name: "texte", label: "Texte", type: "text" }, { name: "etiquettes", label: "Étiquettes", showIf: { action: "créer une issue" }, help: "Séparées par des virgules" },
      { name: "numero", label: "N° de l'issue / PR", showIf: { action: "commenter" } }, { name: "fichier_action", label: "Fichier du workflow", showIf: { action: "lancer une action" }, help: "Ex. deploy.yml" }, { name: "branche", label: "Branche", default: "main", showIf: { action: "lancer une action" } },
      { name: "chemin", label: "Chemin de l'API", showIf: { action: "appel libre" }, help: "Ex. /repos/{depot}/commits" }, { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PATCH", "PUT", "DELETE"], default: "GET", showIf: { action: "appel libre" } }, { name: "corps", label: "Corps (JSON)", type: "json", showIf: { action: "appel libre" } }],
    run: async (p, ctx, api) => {
      const h = { Authorization: `Bearer ${await need(api, p.jeton)}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dysizz-flow" };
      const R = `https://api.github.com/repos/${p.depot}`;
      const g = (u, o = {}) => call(u, { ...o, headers: h, name: "GitHub" });
      switch (p.action) {
        case "créer une issue": { const j = await g(`${R}/issues`, { method: "POST", body: { title: p.titre, body: p.texte || "", labels: p.etiquettes ? String(p.etiquettes).split(",").map((s) => s.trim()) : [] } }); return { numero: j.number, url: j.html_url }; }
        case "commenter": { const j = await g(`${R}/issues/${+p.numero}/comments`, { method: "POST", body: { body: p.texte || "" } }); return { url: j.html_url }; }
        case "lister les issues": return (await g(`${R}/issues?state=open&per_page=50`)).filter((i) => !i.pull_request).map((i) => ({ numero: i.number, titre: i.title, auteur: i.user.login, etiquettes: i.labels.map((l) => l.name), cree: i.created_at, url: i.html_url }));
        case "lister les pull requests": return (await g(`${R}/pulls?state=open&per_page=50`)).map((i) => ({ numero: i.number, titre: i.title, auteur: i.user.login, branche: i.head.ref, brouillon: i.draft, cree: i.created_at, url: i.html_url }));
        case "dernière version": { const j = await g(`${R}/releases/latest`); return { version: j.tag_name, nom: j.name, publiee: j.published_at, notes: j.body, url: j.html_url }; }
        case "lancer une action": await g(`${R}/actions/workflows/${encodeURIComponent(p.fichier_action)}/dispatches`, { method: "POST", body: { ref: p.branche || "main" } }); return { lance: p.fichier_action };
        default: return g(`https://api.github.com${String(p.chemin || "/").replace("{depot}", p.depot)}`, { method: p.methode, body: json(p.corps) });
      }
    },
  },
  {
    name: "dzf_gitlab", label: "GitLab", category: "DevOps", icon: "fab fa-gitlab", output: "gitlab", timeout: 60,
    description: "Créer une issue, lister les merge requests, lancer un pipeline ou appeler l'API GitLab (gitlab.com ou ton instance).",
    params: [{ name: "adresse", label: "Instance", default: "https://gitlab.com" }, { name: "jeton", label: "Secret du jeton", default: "GITLAB_TOKEN" }, { name: "projet", label: "Projet", required: true, help: "groupe/projet ou n° du projet" },
      { name: "action", label: "Action", type: "select", options: ["créer une issue", "lister les issues", "lister les merge requests", "lancer un pipeline", "état des pipelines", "appel libre"], default: "créer une issue" },
      { name: "titre", label: "Titre" }, { name: "texte", label: "Texte", type: "text" }, { name: "branche", label: "Branche", default: "main" },
      { name: "chemin", label: "Chemin de l'API", showIf: { action: "appel libre" }, help: "Ex. /projects/{projet}/repository/commits" }, { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PUT", "DELETE"], default: "GET", showIf: { action: "appel libre" } }, { name: "corps", label: "Corps (JSON)", type: "json", showIf: { action: "appel libre" } }],
    run: async (p, ctx, api) => {
      const h = { "PRIVATE-TOKEN": await need(api, p.jeton) };
      const B = `${String(p.adresse).replace(/\/$/, "")}/api/v4`, P = `${B}/projects/${encodeURIComponent(p.projet)}`;
      const g = (u, o = {}) => call(u, { ...o, headers: h, name: "GitLab" });
      switch (p.action) {
        case "créer une issue": { const j = await g(`${P}/issues`, { method: "POST", body: { title: p.titre, description: p.texte || "" } }); return { numero: j.iid, url: j.web_url }; }
        case "lister les issues": return (await g(`${P}/issues?state=opened&per_page=50`)).map((i) => ({ numero: i.iid, titre: i.title, auteur: i.author.username, etiquettes: i.labels, url: i.web_url }));
        case "lister les merge requests": return (await g(`${P}/merge_requests?state=opened&per_page=50`)).map((i) => ({ numero: i.iid, titre: i.title, auteur: i.author.username, branche: i.source_branch, url: i.web_url }));
        case "lancer un pipeline": { const j = await g(`${P}/pipeline`, { method: "POST", body: { ref: p.branche || "main" } }); return { id: j.id, etat: j.status, url: j.web_url }; }
        case "état des pipelines": return (await g(`${P}/pipelines?per_page=10`)).map((x) => ({ id: x.id, etat: x.status, branche: x.ref, quand: x.updated_at, url: x.web_url }));
        default: return g(B + String(p.chemin || "/").replace("{projet}", encodeURIComponent(p.projet)), { method: p.methode, body: json(p.corps) });
      }
    },
  },
  {
    name: "dzf_docker", label: "Docker : conteneurs", category: "DevOps", icon: "fab fa-docker", output: "docker", timeout: 60,
    description: "Lister les conteneurs et leur état, redémarrer / arrêter / démarrer un conteneur, lire ses journaux ou ses statistiques. Nécessite le socket Docker monté dans Saltcorn (idéalement via un proxy en lecture).",
    params: [{ name: "docker", label: "Socket ou adresse", default: "/var/run/docker.sock", help: "Conseillé : tecnativa/docker-socket-proxy → http://docker-proxy:2375" },
      { name: "action", label: "Action", type: "select", options: ["lister", "détail", "journaux", "statistiques", "redémarrer", "arrêter", "démarrer"], default: "lister" },
      { name: "conteneur", label: "Conteneur (nom ou id)" }, { name: "lignes", label: "Lignes de journal", type: "int", default: 100, showIf: { action: "journaux" } }],
    run: async (p) => {
      const c = encodeURIComponent(String(p.conteneur || "").trim());
      if (p.action === "lister") return (await docker(p, "GET", "/containers/json?all=1")).map((x) => ({ nom: (x.Names[0] || "").replace(/^\//, ""), image: x.Image, etat: x.State, statut: x.Status, id: x.Id.slice(0, 12), projet: x.Labels["com.docker.compose.project"] || "" }));
      if (!c) throw perm("indique le conteneur");
      if (p.action === "détail") { const j = await docker(p, "GET", `/containers/${c}/json`); return { nom: j.Name.replace(/^\//, ""), image: j.Config.Image, etat: j.State.Status, sante: j.State.Health ? j.State.Health.Status : null, demarre: j.State.StartedAt, redemarrages: j.RestartCount }; }
      if (p.action === "journaux") return demux(await docker(p, "GET", `/containers/${c}/logs?stdout=1&stderr=1&timestamps=1&tail=${Math.min(5000, +p.lignes || 100)}`));
      if (p.action === "statistiques") {
        const s = await docker(p, "GET", `/containers/${c}/stats?stream=false`);
        const cpu = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage, sys = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
        return { cpu_pct: sys > 0 ? +((cpu / sys) * (s.cpu_stats.online_cpus || 1) * 100).toFixed(1) : 0, memoire_mo: Math.round((s.memory_stats.usage || 0) / 1048576), memoire_max_mo: Math.round((s.memory_stats.limit || 0) / 1048576) };
      }
      const act = { "redémarrer": "restart", "arrêter": "stop", "démarrer": "start" }[p.action];
      await docker(p, "POST", `/containers/${c}/${act}`);
      return { conteneur: p.conteneur, fait: p.action };
    },
  },
  {
    name: "dzf_dokploy", label: "Dokploy : déployer", category: "DevOps", icon: "fas fa-rocket", output: "dokploy", timeout: 60,
    description: "Redéploie une application ou un compose sur ton Dokploy, ou liste tes projets et leur état.",
    params: [{ name: "adresse", label: "Adresse de Dokploy", required: true, help: "Ex. https://dokploy.mondomaine.fr" }, { name: "cle", label: "Secret de la clé API", default: "DOKPLOY_KEY" },
      { name: "action", label: "Action", type: "select", options: ["lister les projets", "redéployer une application", "redéployer un compose"], default: "lister les projets" }, { name: "id", label: "Id de l'application ou du compose" }],
    run: async (p, ctx, api) => {
      const B = `${String(p.adresse).replace(/\/$/, "")}/api`, h = { "x-api-key": await need(api, p.cle) };
      if (p.action === "lister les projets") return (await call(`${B}/project.all`, { headers: h, name: "Dokploy" })).map((x) => ({ id: x.projectId, nom: x.name, applications: (x.applications || []).map((a) => ({ id: a.applicationId, nom: a.name, etat: a.applicationStatus })), composes: (x.compose || []).map((a) => ({ id: a.composeId, nom: a.name, etat: a.composeStatus })) }));
      const isApp = p.action.includes("application");
      await call(`${B}/${isApp ? "application.redeploy" : "compose.redeploy"}`, { method: "POST", headers: h, body: isApp ? { applicationId: p.id } : { composeId: p.id }, name: "Dokploy" });
      return { redeploie: p.id };
    },
  },
  {
    name: "dzf_kubernetes", label: "Kubernetes", category: "DevOps", icon: "fas fa-dharmachakra", output: "k8s", timeout: 60,
    description: "Lister les pods et leur état, redémarrer un déploiement, changer le nombre de répliques, lire les journaux d'un pod — ou tout appel à l'API Kubernetes.",
    params: [{ name: "adresse", label: "Adresse de l'API", default: "https://kubernetes.default.svc" }, { name: "jeton", label: "Secret du jeton (ServiceAccount)", default: "K8S_TOKEN" }, { name: "espace", label: "Namespace", default: "default" },
      { name: "action", label: "Action", type: "select", options: ["lister les pods", "redémarrer un déploiement", "répliques", "journaux d'un pod", "appel libre"], default: "lister les pods" },
      { name: "nom", label: "Nom (déploiement ou pod)" }, { name: "repliques", label: "Répliques", type: "int", showIf: { action: "répliques" } },
      { name: "chemin", label: "Chemin", showIf: { action: "appel libre" }, help: "Ex. /apis/apps/v1/namespaces/default/deployments" }, { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PATCH", "DELETE"], default: "GET", showIf: { action: "appel libre" } }, { name: "corps", label: "Corps (JSON)", type: "json", showIf: { action: "appel libre" } }],
    run: async (p, ctx, api) => {
      const B = String(p.adresse).replace(/\/$/, ""), ns = encodeURIComponent(p.espace || "default"), n = encodeURIComponent(p.nom || "");
      const h = { Authorization: `Bearer ${await need(api, p.jeton)}` };
      const g = (u, o = {}) => call(B + u, { ...o, headers: { ...h, ...(o.headers || {}) }, name: "Kubernetes" });
      const patch = (u, body) => fetch(B + u, { method: "PATCH", headers: { ...h, "Content-Type": "application/strategic-merge-patch+json" }, body: JSON.stringify(body) }).then(async (r) => { if (!r.ok) throw new Error(`Kubernetes : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); });
      switch (p.action) {
        case "lister les pods": return (await g(`/api/v1/namespaces/${ns}/pods`)).items.map((x) => ({ nom: x.metadata.name, etat: x.status.phase, pret: (x.status.containerStatuses || []).every((c) => c.ready), redemarrages: (x.status.containerStatuses || []).reduce((s, c) => s + c.restartCount, 0), noeud: x.spec.nodeName, depuis: x.status.startTime }));
        case "redémarrer un déploiement": await patch(`/apis/apps/v1/namespaces/${ns}/deployments/${n}`, { spec: { template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } } } } }); return { redemarre: p.nom };
        case "répliques": await patch(`/apis/apps/v1/namespaces/${ns}/deployments/${n}/scale`, { spec: { replicas: +p.repliques } }); return { deploiement: p.nom, repliques: +p.repliques };
        case "journaux d'un pod": { const r = await fetch(`${B}/api/v1/namespaces/${ns}/pods/${n}/log?tailLines=200`, { headers: h }); if (!r.ok) throw new Error(`Kubernetes : HTTP ${r.status}`); return r.text(); }
        default: return g(p.chemin, { method: p.methode, body: json(p.corps) });
      }
    },
  },
  {
    name: "dzf_cloudflare", label: "Cloudflare", category: "DevOps", icon: "fab fa-cloudflare", output: "cloudflare", timeout: 60,
    description: "Gérer les enregistrements DNS d'une zone (lister, créer, modifier l'IP — pratique pour du DNS dynamique), vider le cache, ou tout appel à l'API Cloudflare.",
    params: [{ name: "jeton", label: "Secret du jeton API", default: "CLOUDFLARE_TOKEN" }, { name: "zone", label: "Domaine (zone)", required: true, help: "Ex. mondomaine.fr" },
      { name: "action", label: "Action", type: "select", options: ["lister les DNS", "créer ou mettre à jour un DNS", "supprimer un DNS", "vider le cache", "appel libre"], default: "lister les DNS" },
      { name: "nom", label: "Nom de l'enregistrement", help: "Ex. app.mondomaine.fr" }, { name: "type", label: "Type", type: "select", options: ["A", "AAAA", "CNAME", "TXT", "MX"], default: "A" }, { name: "valeur", label: "Valeur", help: "IP, cible… « auto » = ton IP publique actuelle" },
      { name: "proxy", label: "Passer par Cloudflare (orange)", type: "bool", default: false }, { name: "chemin", label: "Chemin", showIf: { action: "appel libre" } }, { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PATCH", "PUT", "DELETE"], default: "GET", showIf: { action: "appel libre" } }, { name: "corps", label: "Corps (JSON)", type: "json", showIf: { action: "appel libre" } }],
    run: async (p, ctx, api) => {
      const h = { Authorization: `Bearer ${await need(api, p.jeton)}` };
      const g = async (u, o = {}) => (await call(`https://api.cloudflare.com/client/v4${u}`, { ...o, headers: h, name: "Cloudflare" })).result;
      const [zone] = await g(`/zones?name=${encodeURIComponent(p.zone)}`);
      if (!zone) throw perm(`zone ${p.zone} introuvable pour ce jeton`);
      const Z = `/zones/${zone.id}`;
      if (p.action === "lister les DNS") return (await g(`${Z}/dns_records?per_page=500`)).map((r) => ({ id: r.id, nom: r.name, type: r.type, valeur: r.content, proxy: r.proxied, ttl: r.ttl }));
      if (p.action === "vider le cache") { await g(`${Z}/purge_cache`, { method: "POST", body: { purge_everything: true } }); return { vide: p.zone }; }
      if (p.action === "appel libre") return g(String(p.chemin || "").replace("{zone}", zone.id), { method: p.methode, body: json(p.corps) });
      const [ex] = await g(`${Z}/dns_records?type=${p.type}&name=${encodeURIComponent(p.nom)}`);
      if (p.action === "supprimer un DNS") { if (ex) await g(`${Z}/dns_records/${ex.id}`, { method: "DELETE" }); return { supprime: !!ex }; }
      let val = p.valeur;
      if (!val || val === "auto") val = (await (await fetch(p.type === "AAAA" ? "https://api64.ipify.org" : "https://api.ipify.org")).text()).trim();
      if (ex && ex.content === val && ex.proxied === !!p.proxy) return { nom: p.nom, valeur: val, change: false };
      const body = { type: p.type, name: p.nom, content: val, proxied: !!p.proxy, ttl: 1 };
      await g(ex ? `${Z}/dns_records/${ex.id}` : `${Z}/dns_records`, { method: ex ? "PUT" : "POST", body });
      return { nom: p.nom, valeur: val, change: true, cree: !ex };
    },
  },
  {
    name: "dzf_ovh", label: "OVHcloud : API (appel libre)", category: "OVHcloud", icon: "fas fa-server", output: "ovh", timeout: 60,
    description: "Appelle l'API OVHcloud (signée) : tes serveurs, domaines, zones DNS, factures, e-mails MX Plan… Ex. GET /me/bill pour tes factures.",
    params: [{ name: "cles", label: "Secret des clés", default: "OVH_CLES", help: "Secret « APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY »" }, { name: "zone", label: "Région", type: "select", options: ["ovh-eu", "ovh-ca", "ovh-us"], default: "ovh-eu" },
      { name: "methode", label: "Méthode", type: "select", options: ["GET", "POST", "PUT", "DELETE"], default: "GET" }, { name: "chemin", label: "Chemin", required: true, default: "/me", help: "Ex. /domain/zone/mondomaine.fr/record, /dedicated/server, /me/bill" }, { name: "corps", label: "Corps (JSON)", type: "json" }],
    run: async (p, ctx, api) => {
      const [ak, as, ck] = String(await need(api, p.cles)).split(":").map((s) => s.trim());
      if (!ak || !as || !ck) throw perm("le secret doit être « APPLICATION_KEY:APPLICATION_SECRET:CONSUMER_KEY »");
      const B = { "ovh-eu": "https://eu.api.ovh.com/1.0", "ovh-ca": "https://ca.api.ovh.com/1.0", "ovh-us": "https://api.us.ovhcloud.com/1.0" }[p.zone];
      const t = await (await fetch(`${B}/auth/time`)).text();
      const url = B + p.chemin, body = p.corps ? JSON.stringify(json(p.corps)) : "";
      const sig = "$1$" + crypto.createHash("sha1").update([as, ck, p.methode, url, body, t].join("+")).digest("hex");
      const r = await fetch(url, { method: p.methode, headers: { "X-Ovh-Application": ak, "X-Ovh-Consumer": ck, "X-Ovh-Timestamp": t, "X-Ovh-Signature": sig, "Content-Type": "application/json" }, body: body || undefined });
      const txt = await r.text();
      let j; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
      if (!r.ok) throw new Error(`OVH : HTTP ${r.status} ${(j && j.message) || txt.slice(0, 200)}`);
      return j;
    },
  },
];
