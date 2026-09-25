/* Pages d'administration (suite) :
   /dysizz-flow/api          tes points d'API publics (exposition)
   /dysizz-flow/coffre       les secrets chiffrés (jamais réaffichés)
   /dysizz-flow/supervision  ce qui tourne : blocs, erreurs, workflows, serveur */
"use strict";
const os = require("os");
const { esc, isAdmin, denied } = require("./core");
const { page, go, hidden } = require("./admin");
const { ensureTables } = require("./store");
const { liveMetrics } = require("./engine");
const expose = require("./expose");

const sel = (name, opts, cur) => `<select class="form-select form-select-sm" name="${name}">${opts.map((o) => `<option ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
const workflows = () => {
  try { return require("@saltcorn/data/models/trigger").find({ action: "Workflow" }).map((t) => t.name).sort(); } catch (e) { return []; }
};

/* ---------- points d'API ---------- */
const apiPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { points } = await ensureTables();
  const rows = await points.getRows({}, { orderBy: "nom" });
  const wfs = workflows();
  const base = `${req.protocol}://${req.get ? req.get("host") : ""}`;
  const form = (p = {}) => `<form method="post" action="/dysizz-flow/api/save" class="dzf-point">${hidden(req)}<input type="hidden" name="id" value="${p.id || ""}">
<label>Nom (dans l'adresse)<input class="form-control form-control-sm" name="nom" value="${esc(p.nom || "")}" required pattern="[a-z0-9][a-z0-9_-]{0,60}" placeholder="ex. contact"></label>
<label>Workflow lancé${wfs.length ? `<select class="form-select form-select-sm" name="workflow">${wfs.map((w) => `<option ${w === p.workflow ? "selected" : ""}>${esc(w)}</option>`).join("")}</select>` : '<input class="form-control form-control-sm" name="workflow" placeholder="crée d\'abord un workflow">'}</label>
<label>Méthode${sel("methode", expose.METHODES, p.methode || "POST")}</label>
<label>Protection${sel("auth", expose.AUTHS, p.auth || "jeton")}</label>
<label>Secret (nom dans le coffre)<input class="form-control form-control-sm" name="secret" value="${esc(p.secret || "")}" placeholder="ex. API_CONTACT"></label>
<label>En-tête de signature (hmac)<input class="form-control form-control-sm" name="en_tete_signature" value="${esc(p.en_tete_signature || "x-signature")}"></label>
<label>Variable renvoyée<input class="form-control form-control-sm" name="reponse" value="${esc(p.reponse || "")}" placeholder="vide = {ok:true}"></label>
<label>Agir au nom de (e-mail, facultatif)<input class="form-control form-control-sm" name="executer_en" value="${esc(p.executer_en || "")}" placeholder="vide = visiteur (public)"></label>
<label>Requêtes / minute / IP<input class="form-control form-control-sm" type="number" min="1" max="10000" name="limite_minute" value="${p.limite_minute || 60}"></label>
<label class="dzf-check"><input type="checkbox" name="actif" ${p.actif !== false ? "checked" : ""}> Actif</label>
<div class="dzf-save"><button class="btn btn-sm btn-primary">${p.id ? "Enregistrer" : "Créer le point"}</button>
${p.id ? `<button class="btn btn-sm btn-outline-danger" formaction="/dysizz-flow/api/delete" onclick="return confirm('Supprimer ce point ?')">Supprimer</button>` : ""}</div></form>`;
  page(res, req, "Points d'API", "api", `
<div class="dzf-head"><div><h1>Points d'API</h1>
<p>Ouvre une adresse publique qui lance un de tes workflows : webhook de GitHub ou Stripe, formulaire d'un site, appel depuis ton téléphone ou un autre service. Le workflow reçoit <code>corps</code>, <code>query</code>, <code>entetes</code>, <code>ip</code>, <code>methode</code> ; il peut mettre <code>statut_http</code> dans son contexte pour choisir le code de réponse. Par défaut il tourne avec les droits d'un visiteur ; pour écrire dans des tables protégées, choisis un compte (idéalement un compte « robot » dédié, pas le tien).</p>
<p class="dzf-muted">Protection <b>jeton</b> : en-tête <code>Authorization: Bearer …</code> ou <code>X-Api-Key</code>. <b>hmac</b> : signature SHA-256 du corps brut (hex, « sha256= » accepté). Les secrets se rangent dans le <a href="/dysizz-flow/coffre">coffre</a> ou en variable d'environnement.</p></div></div>
${rows.map((p) => `<details class="dzf-box"><summary><b>${esc(p.nom)}</b> <code>${esc(p.methode || "POST")} ${esc(base)}/dzf/api/${esc(p.nom)}</code> → ${esc(p.workflow || "?")} · ${esc(p.auth)}${p.actif ? "" : ' · <span class="dzf-muted">inactif</span>'}</summary>${form(p)}</details>`).join("") || '<p class="dzf-muted">Aucun point pour l\'instant.</p>'}
<h2>Nouveau point</h2>${form()}`);
};
const apiSave = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const b = req.body || {};
  const nom = String(b.nom || "").trim().toLowerCase();
  if (!expose.NOM_RE.test(nom)) return go(res, "/dysizz-flow/api", "Nom invalide : minuscules, chiffres, - et _", true);
  const auth = expose.AUTHS.includes(b.auth) ? b.auth : "jeton";
  if (auth !== "aucune" && !String(b.secret || "").trim()) return go(res, "/dysizz-flow/api", "Il faut un nom de secret pour cette protection", true);
  const row = { nom, workflow: String(b.workflow || "").slice(0, 120), methode: expose.METHODES.includes(b.methode) ? b.methode : "POST", auth, secret: String(b.secret || "").replace(/[^\w.-]/g, "").slice(0, 80), en_tete_signature: String(b.en_tete_signature || "x-signature").replace(/[^\w-]/g, "").slice(0, 60), reponse: String(b.reponse || "").replace(/[^\w.]/g, "").slice(0, 60), limite_minute: Math.min(10000, Math.max(1, +b.limite_minute || 60)), actif: b.actif === "on", executer_en: String(b.executer_en || "").trim().slice(0, 120) };
  if (row.executer_en) {
    const u = await require("@saltcorn/data/models/user").findOne({ email: row.executer_en });
    if (!u) return go(res, "/dysizz-flow/api", `Aucun compte ${row.executer_en}`, true);
  }
  const { points } = await ensureTables();
  try {
    if (b.id) await points.updateRow(row, +b.id); else await points.insertRow(row);
  } catch (e) { return go(res, "/dysizz-flow/api", `Impossible : ${e.message}`, true); }
  expose.forget();
  go(res, "/dysizz-flow/api", `Point « ${nom} » enregistré`);
};
const apiDelete = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { points } = await ensureTables();
  await points.deleteRows({ id: +(req.body || {}).id });
  expose.forget();
  go(res, "/dysizz-flow/api", "Point supprimé");
};

/* ---------- écouteurs de boîtes mail ---------- */
const ecoutePage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { ecouteurs } = await ensureTables();
  const rows = await ecouteurs.getRows({}, { orderBy: "nom" });
  const vivants = new Map(require("./ecouteurs").etat().map((x) => [x.nom, x]));
  const form = (e = {}) => `<form method="post" action="/dysizz-flow/ecouteurs/save" class="dzf-point">${hidden(req)}<input type="hidden" name="id" value="${e.id || ""}">
<label>Nom<input class="form-control form-control-sm" name="nom" value="${esc(e.nom || "")}" required pattern="[a-z0-9][a-z0-9_-]{0,60}" placeholder="ex. info-agence"></label>
<label>Serveur IMAP<input class="form-control form-control-sm" name="serveur" value="${esc(e.serveur || "")}" required placeholder="ssl0.ovh.net"></label>
<label>Port<input class="form-control form-control-sm" type="number" name="port" value="${esc(e.port || 993)}"></label>
<label>Identifiant<input class="form-control form-control-sm" name="utilisateur" value="${esc(e.utilisateur || "")}" required></label>
<label>Mot de passe (nom du secret)<input class="form-control form-control-sm" name="secret" value="${esc(e.secret || "")}" required placeholder="ex. MAIL_INFO"></label>
<label>Dossier<input class="form-control form-control-sm" name="dossier" value="${esc(e.dossier || "INBOX")}"></label>
<label>Table où ranger les mails<input class="form-control form-control-sm" name="table_dest" value="${esc(e.table_dest || "")}" required placeholder="ex. mails_entrants"></label>
<label class="dzf-check"><input type="checkbox" name="marquer_lu" ${e.marquer_lu ? "checked" : ""}> Marquer les mails comme lus (sinon : lecture seule stricte)</label>
<label class="dzf-check"><input type="checkbox" name="actif" ${e.actif !== false ? "checked" : ""}> Actif</label>
<button class="btn btn-primary btn-sm">Enregistrer et (re)démarrer</button></form>`;
  page(res, req, "Écouteurs de boîtes mail", "ecouteurs", `<div class="dzf-intro"><p>Un écouteur reste connecté à une boîte (IMAP IDLE) : chaque nouveau mail est rangé dans ta table puis l'événement <code>DzfMailRecu</code> est émis. Crée un workflow « Quand : DzfMailRecu » pour le traiter. Relève de secours toutes les 5 minutes. Par défaut rien n'est modifié sur le serveur.</p></div>
${rows.map((e) => { const v = vivants.get(e.nom); return `<details class="dzf-box"><summary><b>${esc(e.nom)}</b> ${esc(e.utilisateur)} · ${esc(e.dossier || "INBOX")} → <code>${esc(e.table_dest)}</code> · <span class="${e.etat === "erreur" ? "ko" : "ok"}">${esc(e.etat || (e.actif ? "en attente" : "arrêté"))}</span>${e.vu_le ? " · vu " + esc(new Date(e.vu_le).toLocaleString("fr-FR")) : ""} · ${+e.recus || 0} reçu(s)${e.erreur ? ` · <span class="ko">${esc(e.erreur)}</span>` : ""}</summary>${form(e)}
<form method="post" action="/dysizz-flow/ecouteurs/delete">${hidden(req)}<input type="hidden" name="id" value="${e.id}"><button class="btn btn-outline-danger btn-sm">Supprimer</button></form></details>`; }).join("") || '<p class="dzf-muted">Aucun écouteur.</p>'}
<h2>Nouvel écouteur</h2>${form()}`);
};
const ecouteSave = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const b = req.body || {};
  const nom = String(b.nom || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(nom)) return go(res, "/dysizz-flow/ecouteurs", "Nom invalide", true);
  const table = String(b.table_dest || "").trim();
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(table)) return go(res, "/dysizz-flow/ecouteurs", "Nom de table invalide (minuscules, chiffres, _)", true);
  const row = { nom, serveur: String(b.serveur || "").trim(), port: +b.port || 993, utilisateur: String(b.utilisateur || "").trim(), secret: String(b.secret || "").replace(/[^\w.-]/g, ""), dossier: String(b.dossier || "INBOX").trim(), table_dest: table, marquer_lu: b.marquer_lu === "on", actif: b.actif === "on" };
  const { ecouteurs } = await ensureTables();
  try { if (b.id) await ecouteurs.updateRow(row, +b.id); else await ecouteurs.insertRow({ ...row, dernier_uid: 0, recus: 0 }); } catch (e) { return go(res, "/dysizz-flow/ecouteurs", "Impossible : " + e.message, true); }
  await require("./ecouteurs").tableDest(table).catch(() => {});
  await require("./ecouteurs").demarrerTous().catch(() => 0);
  go(res, "/dysizz-flow/ecouteurs", `Écouteur « ${nom} » enregistré : il démarre dans les 30 secondes`);
};
const ecouteDelete = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { ecouteurs } = await ensureTables();
  await ecouteurs.deleteRows({ id: +(req.body || {}).id });
  await require("./ecouteurs").demarrerTous().catch(() => 0);
  go(res, "/dysizz-flow/ecouteurs", "Écouteur supprimé");
};

/* ---------- coffre ---------- */
const vaultPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { secrets } = await ensureTables();
  const rows = await secrets.getRows({}, { orderBy: "nom" });
  const keyOk = !!(process.env.DZF_CLE_COFFRE || process.env.SALTCORN_SESSION_SECRET);
  page(res, req, "Coffre", "coffre", `
<div class="dzf-head"><div><h1>Coffre de secrets</h1>
<p>Mots de passe, clés d'API, jetons : rangés <b>chiffrés</b> (AES-256-GCM) dans la base. Une sauvegarde de la base ne les montre jamais en clair. Une fois enregistré, un secret n'est plus jamais réaffiché : on peut seulement le remplacer ou le supprimer.</p>
<p class="dzf-muted">Dans les blocs, tu donnes le <b>nom</b> du secret. Une variable d'environnement du même nom passe toujours avant le coffre. ${keyOk ? (process.env.DZF_CLE_COFFRE ? "Clé : DZF_CLE_COFFRE ✓" : "Clé dérivée de SALTCORN_SESSION_SECRET. Mieux : définis DZF_CLE_COFFRE sur le serveur (et garde-la de côté, sans elle les secrets sont perdus).") : '<b class="text-danger">Aucune clé : définis DZF_CLE_COFFRE sur le serveur.</b>'}</p></div></div>
<table class="dzf-table"><tr><th>Nom</th><th>Note</th><th>Modifié</th><th>Env. prioritaire</th><th></th></tr>
${rows.map((r) => `<tr><td><code>${esc(r.nom)}</code></td><td>${esc(r.note || "")}</td><td>${r.maj_le ? esc(new Date(r.maj_le).toLocaleString("fr-FR")) : ""}</td><td>${process.env[r.nom] ? "oui" : ""}</td><td><form method="post" action="/dysizz-flow/coffre/delete">${hidden(req)}<input type="hidden" name="nom" value="${esc(r.nom)}"><button class="btn btn-sm btn-outline-danger" onclick="return confirm('Supprimer ce secret ?')">Supprimer</button></form></td></tr>`).join("") || '<tr><td colspan="5" class="dzf-muted">Le coffre est vide.</td></tr>'}</table>
<h2>Ajouter ou remplacer</h2>
<form method="post" action="/dysizz-flow/coffre/save" class="dzf-point" autocomplete="off">${hidden(req)}
<label>Nom<input class="form-control form-control-sm" name="nom" required pattern="[A-Za-z_][A-Za-z0-9_.-]{0,79}" placeholder="ex. OVH_IMAP_MDP"></label>
<label>Valeur<input class="form-control form-control-sm" type="password" name="valeur" required autocomplete="new-password"></label>
<label>Note (facultatif)<input class="form-control form-control-sm" name="note" placeholder="à quoi il sert"></label>
<div class="dzf-save"><button class="btn btn-sm btn-primary"><i class="fas fa-lock"></i> Ranger</button></div></form>`);
};
const vaultSave = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const b = req.body || {};
  const nom = String(b.nom || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(nom) || !b.valeur) return go(res, "/dysizz-flow/coffre", "Nom ou valeur invalide", true);
  try { await require("./vault").writeSecret(nom, String(b.valeur), String(b.note || "").slice(0, 200)); } catch (e) { return go(res, "/dysizz-flow/coffre", e.message, true); }
  go(res, "/dysizz-flow/coffre", `Secret « ${nom} » rangé`);
};
const vaultDelete = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { secrets } = await ensureTables();
  await secrets.deleteRows({ nom: String((req.body || {}).nom || "") });
  go(res, "/dysizz-flow/coffre", "Secret supprimé");
};

/* ---------- supervision ---------- */
const bar = (v, max, bad) => `<span class="dzf-bar${bad ? " bad" : ""}"><i style="width:${Math.min(100, Math.round((100 * v) / (max || 1)))}%"></i></span>`;
const monitorPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const T = await ensureTables();
  const since = new Date(Date.now() - 24 * 3600e3);
  const hist = await T.metriques.getRows({ heure: { gt: since } }, { orderBy: "heure" });
  const agg = new Map();
  for (const r of [...hist, ...liveMetrics().map((x) => ({ bloc: x.bloc, n: x.n, erreurs: x.erreurs, ms_moyen: Math.round(x.total_ms / x.n), ms_max: x.max_ms }))]) {
    const a = agg.get(r.bloc) || { n: 0, erreurs: 0, tms: 0, max: 0 };
    a.n += r.n; a.erreurs += r.erreurs; a.tms += r.ms_moyen * r.n; a.max = Math.max(a.max, r.ms_max);
    agg.set(r.bloc, a);
  }
  const blocs = [...agg.entries()].map(([bloc, a]) => ({ bloc, ...a, moy: Math.round(a.tms / (a.n || 1)) })).sort((x, y) => y.n - x.n);
  const maxN = Math.max(1, ...blocs.map((b) => b.n));
  const tot = blocs.reduce((s, b) => s + b.n, 0), err = blocs.reduce((s, b) => s + b.erreurs, 0);
  let runs = [];
  try { runs = await require("@saltcorn/data/models/workflow_run").find({ started_at: { gt: since } }, { orderBy: "id", orderDesc: true, limit: 1000 }); } catch (e) { runs = []; }
  const par = {};
  for (const r of runs) par[r.status] = (par[r.status] || 0) + 1;
  const Trigger = require("@saltcorn/data/models/trigger");
  const errs = runs.filter((r) => r.status === "Error").slice(0, 15);
  const lastErr = await T.journal.getRows({ ok: false }, { orderBy: "id", orderDesc: true, limit: 15 });
  const mem = 100 - Math.round((os.freemem() / os.totalmem()) * 100);
  const planifs = await T.planifs.countRows({ etat: "en attente" }).catch(() => 0);
  const file = await T.file.countRows({ etat: "en attente" }).catch(() => 0);
  const kpi = (l, v, s) => `<div class="dzf-kpi"><small>${l}</small><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
  page(res, req, "Supervision", "supervision", `
<div class="dzf-head"><div><h1>Supervision</h1><p>Les dernières 24 h : exécutions des blocs, workflows, erreurs, et l'état de ce serveur. Les chiffres des blocs sont gardés par heure dans <code>dzf_metriques</code> (graphique possible avec la vue DZ Graphique de dysizz-ui).</p></div>
<a class="btn btn-outline-secondary btn-sm" href="/dysizz-flow/supervision"><i class="fas fa-sync"></i> Rafraîchir</a></div>
<div class="dzf-kpis">
${kpi("Blocs exécutés", tot.toLocaleString("fr-FR"), `${err} en erreur`)}
${kpi("Taux d'erreur", tot ? `${((100 * err) / tot).toFixed(1)} %` : "—")}
${kpi("Workflows lancés", runs.length.toLocaleString("fr-FR"), Object.entries(par).map(([k, v]) => `${k} ${v}`).join(" · "))}
${kpi("En attente", planifs + file, `${planifs} planifiés · ${file} en file`)}
${kpi("Serveur", `${mem} % mém.`, `charge ${os.loadavg()[0].toFixed(2)} · ${os.cpus().length} CPU · ${Math.round(process.memoryUsage().rss / 1048576)} Mo`)}
</div>
<h2>Blocs</h2>
<table class="dzf-table"><tr><th>Bloc</th><th>Exécutions</th><th></th><th>Erreurs</th><th>Moyenne</th><th>Max</th></tr>
${blocs.slice(0, 60).map((b) => `<tr class="${b.erreurs ? "dzf-bad" : ""}"><td><code>${esc(b.bloc)}</code></td><td>${b.n}</td><td>${bar(b.n, maxN, b.erreurs / b.n > 0.1)}</td><td>${b.erreurs}</td><td>${b.moy} ms</td><td>${b.max} ms</td></tr>`).join("") || '<tr><td colspan="6" class="dzf-muted">Rien n\'a tourné ces dernières 24 h.</td></tr>'}</table>
<h2>Workflows en erreur</h2>
<table class="dzf-table"><tr><th>Quand</th><th>Workflow</th><th>Erreur</th><th></th></tr>
${errs.map((r) => `<tr class="dzf-bad"><td>${esc(new Date(r.started_at).toLocaleString("fr-FR"))}</td><td>${esc((Trigger.findOne({ id: r.trigger_id }) || {}).name || r.trigger_id)}</td><td>${esc(String(r.error || "").slice(0, 300))}</td><td><a href="/actions/run/${r.id}">détail</a></td></tr>`).join("") || '<tr><td colspan="4" class="dzf-muted">Aucun.</td></tr>'}</table>
<h2>Dernières erreurs de blocs</h2>
<table class="dzf-table"><tr><th>Quand</th><th>Bloc</th><th>Message</th></tr>
${lastErr.map((r) => `<tr><td>${esc(new Date(r.quand).toLocaleString("fr-FR"))}</td><td><code>${esc(r.bloc)}</code></td><td>${esc(r.message || "")}</td></tr>`).join("") || '<tr><td colspan="3" class="dzf-muted">Aucune.</td></tr>'}</table>`);
};

module.exports = { ecoutePage, ecouteSave, ecouteDelete, apiPage, apiSave, apiDelete, vaultPage, vaultSave, vaultDelete, monitorPage };
