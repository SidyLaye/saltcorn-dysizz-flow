/* Pages d'administration de dysizz-flow :
   /dysizz-flow            la bibliothèque de blocs
   /dysizz-flow/bloc/:nom  un bloc : réglages, code, essai
   /dysizz-flow/atelier    tes blocs perso (création, code, test, export)
   /dysizz-flow/modeles    les modèles de workflows à installer
   /dysizz-flow/journal    les erreurs récentes */
"use strict";
const { esc, isAdmin, denied, VERSION } = require("./core");
const { BLOCKS, CATEGORIES } = require("./blocks");
const { loadUserBlocks, broadcast, NAME_RE, PREFIX } = require("./userblocks");
const { ensureTables } = require("./store");
const { installTemplate, TEMPLATES } = require("./templates/install");

const csrf = (req) => (req.csrfToken ? req.csrfToken() : "");
const hidden = (req) => `<input type="hidden" name="_csrf" value="${esc(csrf(req))}">`;
const TYPES = ["texte", "text", "int", "number", "bool", "select", "table", "json", "code", "password"];
const TYPE_LABEL = { texte: "texte court", text: "texte long", int: "nombre entier", number: "nombre", bool: "oui / non", select: "liste de choix", table: "une table", json: "JSON", code: "code", password: "mot de passe" };

const page = (res, req, title, active, html) => res.sendWrap({ title, requestFluidLayout: true }, {
  above: [{ type: "blank", isHTML: true, contents: `<div class="dzf">
<nav class="dzf-tabs">${[["workflows", "Workflows", "fas fa-project-diagram"], ["modeles", "Catalogue", "fas fa-magic"], ["", "Blocs", "fas fa-cubes"], ["atelier", "Atelier", "fas fa-tools"], ["api", "Points d'API", "fas fa-plug"], ["ecouteurs", "Écouteurs", "fas fa-satellite-dish"], ["coffre", "Coffre", "fas fa-lock"], ["supervision", "Supervision", "fas fa-tachometer-alt"], ["journal", "Journal", "fas fa-clipboard-list"]]
    .map(([u, l, i]) => `<a href="/dysizz-flow${u ? "/" + u : ""}" class="${active === u ? "on" : ""}"><i class="${i}"></i>${l}</a>`).join("")}
<a href="/dysizz" class="dzf-ext"><i class="fas fa-th-large"></i>Accueil</a></nav>
${flash(req)}${html}</div>`.replace(/\{\{/g, "&#123;&#123;").replace(/\}\}/g, "&#125;&#125;") }],
});
/* (les {{ }} sont écrits en entités : Saltcorn les interpréterait sinon comme des variables de page) */
const flash = (req) => {
  const q = req.query || {};
  return (q.ok ? `<div class="dzf-flash ok">${esc(q.ok)}</div>` : "") + (q.err ? `<div class="dzf-flash ko">${esc(q.err)}</div>` : "");
};
const go = (res, url, msg, bad) => res.redirect(`${url}${url.includes("?") ? "&" : "?"}${bad ? "err" : "ok"}=${encodeURIComponent(msg)}`);

const { registerExternal, externalBlocks } = require("./registry");
/* intégrés + apportés par d'autres plugins + les tiens */
const allBlocks = async () => { registerExternal(); return [...BLOCKS, ...externalBlocks(), ...(await loadUserBlocks().catch(() => []))]; };

/* ---------- bibliothèque ---------- */
const library = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const blocks = await allBlocks();
  const cards = CATEGORIES.map((c) => {
    const bs = blocks.filter((b) => b.category === c);
    if (!bs.length && c !== "Mes blocs") return "";
    return `<section class="dzf-cat" data-cat="${esc(c)}"><h2>${esc(c)} <small>${bs.length}</small></h2><div class="dzf-grid">${bs.map((b) => `
<a class="dzf-card" href="/dysizz-flow/bloc/${encodeURIComponent(b.name)}" data-search="${esc((b.label + " " + b.description + " " + b.name).toLowerCase())}">
<span class="dzf-ic"><i class="${esc(b.icon)}"></i></span><span><b>${esc(b.label)}</b><small>${esc(b.description)}</small><code>${esc(b.name)}</code></span></a>`).join("") || '<p class="dzf-muted">Aucun pour l\'instant. <a href="/dysizz-flow/atelier/nouveau">Créer un bloc</a></p>'}</div></section>`;
  }).join("");
  page(res, req, "Blocs workflow", "", `
<div class="dzf-head"><div><h1>Blocs workflow</h1>
<p>${BLOCKS.length} blocs intégrés${externalBlocks().length ? `, ${externalBlocks().length} apportés par d'autres plugins` : ""}, et les tiens. Chaque bloc est une <b>action Saltcorn</b> : ajoute-le comme étape dans un workflow (Paramètres → Déclencheurs → Workflow), sur une table, en planifié ou en bouton. Ses réglages se remplissent dans un formulaire et acceptent des <code>{{variables}}</code> du contexte. Version ${esc(VERSION)}.</p></div>
<a class="btn btn-primary" href="/dysizz-flow/atelier/nouveau"><i class="fas fa-plus"></i> Créer un bloc</a></div>
<input class="form-control dzf-search" placeholder="Chercher un bloc (ex. mail, table, IA, API…)" oninput="dzfSearch(this.value)">
${cards}`);
};

/* ---------- un bloc ---------- */
const blockPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const b = (await allBlocks()).find((x) => x.name === req.params.name);
  if (!b) return res.redirect("/dysizz-flow");
  const example = Object.fromEntries((b.params || []).filter((p) => p.default !== undefined).map((p) => [p.name, p.default]));
  const code = b.custom ? b.code : b.run.toString();
  page(res, req, b.label, "", `
<p><a href="/dysizz-flow">← Bibliothèque</a></p>
<div class="dzf-head"><div><h1><i class="${esc(b.icon)}"></i> ${esc(b.label)}</h1><p>${esc(b.description)}</p>
<p class="dzf-muted">Nom de l'action : <code>${esc(b.name)}</code> · sortie par défaut : <code>${esc(b.output || "resultat")}</code> · catégorie ${esc(b.category)}</p></div>
${b.custom ? `<a class="btn btn-outline-primary" href="/dysizz-flow/atelier/${encodeURIComponent(b.row.nom)}"><i class="fas fa-pen"></i> Modifier dans l'atelier</a>` : `<form method="post" action="/dysizz-flow/atelier/copier">${hidden(req)}<input type="hidden" name="bloc" value="${esc(b.name)}"><button class="btn btn-outline-secondary"><i class="fas fa-copy"></i> Partir de ce bloc dans l'atelier</button></form>`}</div>
<h2>Réglages</h2>
<table class="dzf-table"><tr><th>Réglage</th><th>Type</th><th>Par défaut</th><th>Aide</th></tr>
${(b.params || []).map((p) => `<tr><td><code>${esc(p.name)}</code> ${esc(p.label || "")}${p.required ? ' <span class="dzf-req">obligatoire</span>' : ""}</td><td>${esc(TYPE_LABEL[p.type] || p.type || "texte court")}${p.options ? "<br><small>" + esc(p.options.join(" · ")) + "</small>" : ""}</td><td><code>${esc(p.default === undefined ? "" : typeof p.default === "string" ? p.default : JSON.stringify(p.default))}</code></td><td>${esc(p.help || "")}</td></tr>`).join("")}
<tr class="dzf-common"><td><code>sortie</code> · <code>si_erreur</code> · <code>delai_max</code></td><td colspan="3">Communs à tous les blocs : nom de la variable du résultat, arrêter ou continuer si erreur, délai max.</td></tr></table>
<h2>Essayer</h2>
<div class="dzf-try" data-bloc="${esc(b.name)}">
<div><label>Réglages (JSON)</label><textarea class="form-control dzf-mono" rows="8" data-cfg>${esc(JSON.stringify(example, null, 2))}</textarea></div>
<div><label>Contexte d'entrée (JSON)</label><textarea class="form-control dzf-mono" rows="8" data-ctx>{}</textarea></div>
<div class="dzf-try-bar"><button class="btn btn-primary" type="button" onclick="dzfTry(this)"><i class="fas fa-play"></i> Lancer</button><span class="dzf-muted">Le bloc s'exécute vraiment (écritures comprises).</span></div>
<pre class="dzf-out" data-out>Résultat ici.</pre></div>
<h2>Le code</h2>
<p class="dzf-muted">${b.custom ? "Ton code, exécuté dans le bac à sable de Saltcorn." : "Le code du bloc intégré (fichier src/blocks du dépôt). Pour le changer à ta façon : « Partir de ce bloc dans l'atelier »."}</p>
<pre class="dzf-code">${esc(code)}</pre>
<input type="hidden" id="dzf-csrf" value="${esc(csrf(req))}">`);
};

/* ---------- essai d'un bloc ---------- */
const tryBlock = async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "réservé aux admins" });
  const { getState } = require("@saltcorn/data/db/state");
  const b = req.body || {};
  let cfg, ctx;
  try { cfg = typeof b.cfg === "string" ? JSON.parse(b.cfg || "{}") : b.cfg || {}; ctx = typeof b.ctx === "string" ? JSON.parse(b.ctx || "{}") : b.ctx || {}; } catch (e) { return res.json({ error: `JSON invalide : ${e.message}` }); }
  const action = getState().actions[b.bloc];
  if (!action) return res.json({ error: "bloc inconnu (enregistre-le d'abord)" });
  const t0 = Date.now();
  try {
    const out = await action.run({ configuration: cfg, row: ctx, user: req.user, req, mode: "workflow" });
    res.json({ ok: true, ms: Date.now() - t0, contexte_apres: { ...ctx, ...(out || {}) }, sortie: out });
  } catch (e) {
    res.json({ error: e.message, ms: Date.now() - t0 });
  }
};

/* ---------- atelier ---------- */
const workshop = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const mine = await loadUserBlocks().catch(() => []);
  const { blocs } = await ensureTables();
  const off = await blocs.getRows({ actif: false });
  page(res, req, "Atelier de blocs", "atelier", `
<div class="dzf-head"><div><h1>Atelier</h1><p>Crée tes propres blocs : tu choisis leurs réglages (formulaire no-code) et tu écris leur code. Ils deviennent des actions Saltcorn <code>${PREFIX}…</code>, sur tous les serveurs, sans redémarrer.</p></div>
<div class="dzf-actions"><a class="btn btn-primary" href="/dysizz-flow/atelier/nouveau"><i class="fas fa-plus"></i> Nouveau bloc</a>
<a class="btn btn-outline-secondary" href="/dysizz-flow/atelier/export"><i class="fas fa-download"></i> Exporter</a>
<form method="post" action="/dysizz-flow/atelier/import" enctype="application/x-www-form-urlencoded" class="dzf-import">${hidden(req)}<textarea name="json" class="form-control dzf-mono" rows="1" placeholder="Coller un export JSON…"></textarea><button class="btn btn-outline-secondary">Importer</button></form></div></div>
<div class="dzf-grid">${[...mine, ...off.map((r) => ({ ...r, off: true, label: r.libelle || r.nom, icon: r.icone || "fas fa-cube", description: r.description || "", row: r }))].map((b) => `
<a class="dzf-card${b.off ? " dzf-off" : ""}" href="/dysizz-flow/atelier/${encodeURIComponent(b.row.nom)}"><span class="dzf-ic"><i class="${esc(b.icon)}"></i></span>
<span><b>${esc(b.label)}${b.off ? " (désactivé)" : ""}</b><small>${esc(b.description)}</small><code>${esc(PREFIX + b.row.nom)}</code></span></a>`).join("") || '<p class="dzf-muted">Pas encore de bloc perso.</p>'}</div>`);
};

const editor = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { blocs } = await ensureTables();
  let r = req.params.nom === "nouveau" ? null : await blocs.getRow({ nom: req.params.nom });
  if (!r && req.params.nom !== "nouveau") return res.redirect("/dysizz-flow/atelier");
  r = r || { nom: "", libelle: "", categorie: "Mes blocs", icone: "fas fa-cube", description: "", sortie: "", actif: true, params: JSON.stringify([{ name: "texte", label: "Texte", type: "texte", default: "", help: "" }], null, 1), code: `// params : tes réglages (déjà remplis, {{variables}} remplacées)\n// row    : le contexte du workflow\n// Disponibles : Table, fetch, User, Notification, File, sleep, console…\nconst t = String(params.texte || "");\nreturn { longueur: t.length, majuscules: t.toUpperCase() };` };
  const params = (() => { try { return JSON.parse(r.params || "[]"); } catch (e) { return []; } })();
  page(res, req, r.nom ? `Bloc ${r.nom}` : "Nouveau bloc", "atelier", `
<p><a href="/dysizz-flow/atelier">← Atelier</a></p>
<form method="post" action="/dysizz-flow/atelier/save" class="dzf-editor" onsubmit="return dzfBeforeSave(this)">${hidden(req)}
<input type="hidden" name="ancien" value="${esc(r.nom || "")}"><input type="hidden" name="params" value="${esc(JSON.stringify(params))}">
<div class="dzf-ed-grid">
<label>Nom technique<input class="form-control" name="nom" value="${esc(r.nom)}" required pattern="[a-z][a-z0-9_]{1,40}" placeholder="ex. slack_message"><small>Minuscules, chiffres, _ — l'action s'appellera ${PREFIX}<i>nom</i></small></label>
<label>Libellé<input class="form-control" name="libelle" value="${esc(r.libelle || "")}" placeholder="Slack : envoyer un message"></label>
<label>Icône<input class="form-control" name="icone" value="${esc(r.icone || "fas fa-cube")}"><small>Font Awesome, ex. fab fa-slack</small></label>
<label>Sortie par défaut<input class="form-control" name="sortie" value="${esc(r.sortie || "")}" placeholder="ex. slack"></label>
<label class="dzf-wide">Description<input class="form-control" name="description" value="${esc(r.description || "")}"></label>
<label class="dzf-check"><input type="checkbox" name="actif" ${r.actif !== false ? "checked" : ""}> Actif</label>
</div>
<h2>Réglages du bloc <small>(le formulaire que verra l'utilisateur)</small></h2>
<div class="dzf-params" data-params></div>
<button type="button" class="btn btn-sm btn-outline-secondary" onclick="dzfAddParam()"><i class="fas fa-plus"></i> Ajouter un réglage</button>
<h2>Code</h2>
<textarea name="code" class="form-control dzf-mono dzf-codearea" rows="18" spellcheck="false">${esc(r.code || "")}</textarea>
<div class="dzf-save"><button class="btn btn-primary"><i class="fas fa-save"></i> Enregistrer</button>
${r.nom ? `<button class="btn btn-outline-danger" formaction="/dysizz-flow/atelier/delete" onclick="return confirm('Supprimer ce bloc ? Les workflows qui l\\'utilisent ne marcheront plus.')">Supprimer</button>` : ""}</div>
</form>
${r.nom ? `<h2>Essayer</h2><div class="dzf-try" data-bloc="${esc(PREFIX + r.nom)}">
<div><label>Réglages (JSON)</label><textarea class="form-control dzf-mono" rows="6" data-cfg>${esc(JSON.stringify(Object.fromEntries(params.map((p) => [p.name, p.default ?? ""])), null, 2))}</textarea></div>
<div><label>Contexte d'entrée (JSON)</label><textarea class="form-control dzf-mono" rows="6" data-ctx>{}</textarea></div>
<div class="dzf-try-bar"><button class="btn btn-primary" type="button" onclick="dzfTry(this)"><i class="fas fa-play"></i> Lancer</button><span class="dzf-muted">Enregistre avant d'essayer.</span></div>
<pre class="dzf-out" data-out>Résultat ici.</pre></div>` : ""}
${r.nom ? await versionsHtml(req, r) : ""}
<input type="hidden" id="dzf-csrf" value="${esc(csrf(req))}">
<script>window.__dzfTypes=${JSON.stringify(TYPES.map((t) => [t, TYPE_LABEL[t]]))};</script>`);
};

const versionsHtml = async (req, r) => {
  const { versions } = await ensureTables();
  const vs = await versions.getRows({ nom: r.nom }, { orderBy: "id", orderDesc: true, limit: 30 });
  return `<h2>Versions <small>(actuelle : v${r.version || 1})</small></h2>
<table class="dzf-table"><tr><th>Version</th><th>Quand</th><th>Par</th><th></th></tr>
${vs.map((v) => `<tr><td>v${v.version}</td><td>${esc(new Date(v.quand).toLocaleString("fr-FR"))}</td><td>${esc(v.par || "")}</td><td><form method="post" action="/dysizz-flow/atelier/restaurer">${hidden(req)}<input type="hidden" name="id" value="${v.id}"><button class="btn btn-sm btn-outline-secondary" onclick="return confirm('Remettre la v${v.version} ?')">Remettre</button></form></td></tr>`).join("") || '<tr><td colspan="4" class="dzf-muted">Pas encore d\'ancienne version.</td></tr>'}</table>`;
};

const save = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const b = req.body || {};
  const nom = String(b.nom || "").trim();
  if (!NAME_RE.test(nom)) return go(res, "/dysizz-flow/atelier/nouveau", "Nom invalide : minuscules, chiffres et _ (2 à 41 caractères)", true);
  let params;
  try { params = JSON.parse(b.params || "[]"); if (!Array.isArray(params)) throw new Error("liste attendue"); } catch (e) { return go(res, `/dysizz-flow/atelier/${nom}`, `Réglages invalides : ${e.message}`, true); }
  params = params.filter((p) => p && /^[a-z_][a-z0-9_]*$/i.test(p.name || "")).map((p) => ({ name: p.name, label: String(p.label || p.name), type: TYPES.includes(p.type) ? p.type : "texte", default: p.default ?? "", help: String(p.help || ""), required: !!p.required, ...(p.type === "select" ? { options: String(p.options || "").split(",").map((s) => s.trim()).filter(Boolean) } : {}) }));
  /* le code doit au moins être du JavaScript valide */
  try { new Function(`return (async () => { ${b.code || ""} })`); } catch (e) { return go(res, `/dysizz-flow/atelier/${b.ancien || nom}`, `Code invalide : ${e.message}`, true); }
  const { blocs } = await ensureTables();
  const row = { nom, libelle: String(b.libelle || nom).slice(0, 120), icone: String(b.icone || "fas fa-cube").replace(/[^a-z0-9 -]/gi, "").slice(0, 60), description: String(b.description || "").slice(0, 400), sortie: String(b.sortie || "").replace(/[^\w]/g, "").slice(0, 40), params: JSON.stringify(params), code: String(b.code || ""), actif: b.actif === "on" || b.actif === true || b.actif === "true", categorie: "Mes blocs", maj_le: new Date() };
  const old = await blocs.getRow({ nom: b.ancien || nom });
  if (old) {
    /* on garde l'ancienne version avant d'écraser (les 30 dernières) */
    await snapshot(old, req);
    row.version = (old.version || 1) + 1;
    await blocs.updateRow(row, old.id);
  } else if (await blocs.getRow({ nom })) return go(res, "/dysizz-flow/atelier/nouveau", "Ce nom existe déjà", true); else await blocs.insertRow({ ...row, version: 1 });
  await broadcast();
  go(res, `/dysizz-flow/atelier/${nom}`, `Bloc ${PREFIX}${nom} enregistré et disponible dans les workflows.`);
};

const SNAP = ["nom", "libelle", "icone", "description", "sortie", "params", "code", "actif", "version"];
const snapshot = async (old, req) => {
  const { versions } = await ensureTables();
  await versions.insertRow({ nom: old.nom, version: old.version || 1, contenu: JSON.stringify(Object.fromEntries(SNAP.map((k) => [k, old[k]]))), quand: new Date(), par: (req.user && req.user.email) || "" });
  const all = await versions.getRows({ nom: old.nom }, { orderBy: "id", orderDesc: true });
  for (const v of all.slice(30)) await versions.deleteRows({ id: v.id });
};
const restore = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { blocs, versions } = await ensureTables();
  const v = await versions.getRow({ id: +(req.body || {}).id });
  const cur = v && (await blocs.getRow({ nom: v.nom }));
  if (!v || !cur) return go(res, "/dysizz-flow/atelier", "Version introuvable", true);
  const snap = JSON.parse(v.contenu);
  await snapshot(cur, req);
  await blocs.updateRow({ ...snap, nom: cur.nom, version: (cur.version || 1) + 1, maj_le: new Date() }, cur.id);
  await broadcast();
  go(res, `/dysizz-flow/atelier/${cur.nom}`, `Version ${v.version} remise en place (devient la v${(cur.version || 1) + 1})`);
};

const remove = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { blocs } = await ensureTables();
  await blocs.deleteRows({ nom: String((req.body || {}).ancien || "") });
  await broadcast();
  go(res, "/dysizz-flow/atelier", "Bloc supprimé");
};

/* un bloc intégré copié dans l'atelier : mêmes réglages, code d'exemple qui appelle le bloc d'origine */
const copyBuiltin = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const src = BLOCKS.find((x) => x.name === (req.body || {}).bloc);
  if (!src) return res.redirect("/dysizz-flow");
  const { blocs } = await ensureTables();
  let nom = src.name.replace(/^dzf_/, "") + "_perso", i = 2;
  while (await blocs.getRow({ nom })) nom = src.name.replace(/^dzf_/, "") + "_perso" + i++;
  const code = `// Copie de « ${src.label} ». Elle appelle le bloc d'origine avec tes réglages :
// ajoute ce que tu veux avant (préparer params) ou après (transformer le résultat).
// « Actions » donne accès à toutes les actions Saltcorn, dont les blocs dzf_*.
const r = await Actions.${src.name}({ ...params, sortie: "r" });
return r.r;`;
  await blocs.insertRow({ nom, libelle: `${src.label} (perso)`, icone: src.icon, description: src.description, sortie: src.output || "", params: JSON.stringify(src.params || []), code, actif: true, categorie: "Mes blocs", maj_le: new Date() });
  await broadcast();
  go(res, `/dysizz-flow/atelier/${nom}`, "Copie créée : modifie le code puis enregistre.");
};

const exportBlocks = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { blocs } = await ensureTables();
  const rows = (await blocs.getRows({})).map(({ id, maj_le, ...r }) => r);
  res.setHeader("Content-Disposition", 'attachment; filename="dysizz-flow-blocs.json"');
  res.json({ dysizz_flow: VERSION, blocs: rows });
};
const importBlocks = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  let data;
  try { data = JSON.parse((req.body || {}).json || ""); } catch (e) { return go(res, "/dysizz-flow/atelier", "JSON invalide", true); }
  const { blocs } = await ensureTables();
  let n = 0;
  for (const r of (data && data.blocs) || []) {
    if (!NAME_RE.test(r.nom || "")) continue;
    const row = { nom: r.nom, libelle: r.libelle, icone: r.icone, description: r.description, sortie: r.sortie, params: typeof r.params === "string" ? r.params : JSON.stringify(r.params || []), code: r.code, actif: r.actif !== false, categorie: "Mes blocs", maj_le: new Date() };
    const ex = await blocs.getRow({ nom: r.nom });
    if (ex) await blocs.updateRow(row, ex.id); else await blocs.insertRow(row);
    n++;
  }
  await broadcast();
  go(res, "/dysizz-flow/atelier", `${n} bloc(s) importé(s)`);
};

/* ---------- modèles de workflows ---------- */
const WHEN = ["Never", "Often", "Hourly", "Daily", "Weekly", "Insert", "Update", "API call"];
const WHEN_LABEL = { Never: "à la main (pour tester)", Often: "toutes les ~5 min", Hourly: "toutes les heures", Daily: "chaque jour", Weekly: "chaque semaine", Insert: "à chaque ajout dans la table", Update: "à chaque modification", "API call": "sur appel d'API (webhook)" };
const templates = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { SCHEMAS } = require("./templates/install");
  const Table = require("@saltcorn/data/models/table");
  const byName = Object.fromEntries((await allBlocks()).map((b) => [b.name, b]));
  const cats = [...new Set(TEMPLATES.map((t) => t.category))];
  const CAT_COLOR = { Veille: "#00aba9", Messagerie: "#2d89ef", Organisation: "#00a300", Intégrations: "#603cba", Données: "#1e7145", IA: "#e3008c", Services: "#e3a21a", Surveillance: "#da532c", Sécurité: "#b91d47", Tâches: "#7e3878" };
  /* petit schéma : les étapes en file, avec leur icône */
  const mini = (t) => `<div class="dzf-mini"><span class="dzf-mini-n trig" title="${esc(WHEN_LABEL[t.when] || t.when)}"><i class="fas fa-bolt"></i></span>${t.steps.slice(0, 7).map((st) => {
    const b = byName[st.action_name] || {};
    return `<span class="dzf-mini-l${st.only_if ? " if" : ""}"></span><span class="dzf-mini-n" title="${esc(b.label || st.action_name)}${st.only_if ? " — seulement si " + esc(st.only_if) : ""}"><i class="${esc(b.icon || "fas fa-cog")}"></i></span>`;
  }).join("")}${t.steps.length > 7 ? `<span class="dzf-mini-more">+${t.steps.length - 7}</span>` : ""}</div>`;
  const card = (t) => {
    const needs = (t.vars || []).filter((v) => /^table/.test(v.name));
    const auto = needs.filter((v) => SCHEMAS[`${t.key}.${v.name}`]);
    return `<article class="dzf-tplc" data-cat="${esc(t.category)}" data-search="${esc((t.label + " " + t.description + " " + t.category).toLowerCase())}" style="--c:${CAT_COLOR[t.category] || "#5b5bf0"}">
<div class="dzf-tplc-top"><span class="dzf-tplc-cat">${esc(t.category)}</span><span class="dzf-tplc-when"><i class="far fa-clock"></i> ${esc(WHEN_LABEL[t.when] || t.when)}</span></div>
<h3>${esc(t.label)}</h3><p>${esc(t.description)}</p>${mini(t)}
<details class="dzf-tplc-use"><summary class="btn btn-primary btn-sm"><i class="fas fa-magic"></i> Utiliser ce modèle</summary>
<form method="post" action="/dysizz-flow/modeles/${esc(t.key)}" class="dzf-tplc-form">${hidden(req)}
<label>Nom du workflow<input class="form-control form-control-sm" name="nom" value="${esc(t.key)}"></label>
${(t.vars || []).map((v) => `<label>${esc(v.label)}<input class="form-control form-control-sm" name="${esc(v.name)}" value="${esc(v.default || "")}"${/^table/.test(v.name) ? ` list="dzf-tables"` : ""}></label>`).join("")}
<label>Démarrage<select class="form-select form-select-sm" name="when">${WHEN.map((w) => `<option value="${w}"${w === "Never" ? " selected" : ""}>${esc(WHEN_LABEL[w])}${w === t.when ? " (conseillé)" : ""}</option>`).join("")}</select><small>Conseil : commence « à la main », essaie-le dans l'éditeur, puis choisis sa fréquence.</small></label>
${auto.length ? `<label class="dzf-check"><input type="checkbox" name="creer_tables" value="oui" checked onchange="this.value=this.checked?'oui':'non'"> Créer les tables qui manquent (${auto.map((v) => esc(v.default || v.name)).join(", ")})</label>` : ""}
<button class="btn btn-primary"><i class="fas fa-check"></i> Créer et ouvrir dans l'éditeur</button></form></details></article>`;
  };
  page(res, req, "Catalogue de workflows", "modeles", `
<div class="dzf-head"><div><h1>Catalogue</h1><p>Des workflows prêts à l'emploi. Choisis-en un, réponds à 2 ou 3 questions, il s'ouvre dans l'éditeur visuel : tu vois chaque étape et tu peux tout changer.</p></div>
<a class="btn btn-outline-primary" href="/dysizz-flow/editeur/nouveau"><i class="fas fa-plus"></i> Partir de zéro</a></div>
<input class="form-control dzf-search" placeholder="Chercher (mail, RSS, alerte, IA…)" oninput="dzfSearchWf(this.value)">
<nav class="dzf-chipsbar"><button class="on" onclick="dzfCat(this,'')">Tout <small>${TEMPLATES.length}</small></button>${cats.map((c) => `<button onclick="dzfCat(this,'${esc(c)}')">${esc(c)} <small>${TEMPLATES.filter((t) => t.category === c).length}</small></button>`).join("")}</nav>
<div class="dzf-tplgrid">${TEMPLATES.map(card).join("")}</div>
<datalist id="dzf-tables">${(await Table.find({})).map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>`);
};
const installTpl = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  try {
    const t = TEMPLATES.find((x) => x.key === req.params.key);
    const input = { ...(req.body || {}) };
    if (!input.creer_tables) input.creer_tables = "non";
    if (t && ["Insert", "Update"].includes(input.when) && !t.tableVar) input.when = t.when;
    if (t && t.tableVar && !["Insert", "Update", "Delete"].includes(input.when) && ["Insert", "Update"].includes(t.when)) input.when = input.when === "Never" ? "Never" : t.when;
    const r = await installTemplate(req.params.key, input);
    res.redirect(`/dysizz-flow/editeur/${r.trigger_id}?ok=${encodeURIComponent(`Workflow « ${r.name} » créé${r.created.length ? ` (tables créées : ${r.created.join(", ")})` : ""}${r.point ? `. Son adresse pour tes pages : ${r.point}` : ""}. Clique sur une étape pour la régler, puis « Essayer ».`)}`);
  } catch (e) { go(res, "/dysizz-flow/modeles", e.message, true); }
};

/* ---------- journal ---------- */
const journalPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { journal } = await ensureTables();
  const rows = await journal.getRows({}, { orderBy: "id", orderDesc: true, limit: 300 });
  page(res, req, "Journal", "journal", `
<div class="dzf-head"><div><h1>Journal</h1><p>Les erreurs des blocs (et les exécutions que tu as demandé de noter). Les 300 dernières lignes. Pour le détail pas à pas d'un workflow, active la trace dans Saltcorn (Déclencheurs → Workflow runs).</p></div>
<form method="post" action="/dysizz-flow/journal/vider">${hidden(req)}<button class="btn btn-outline-secondary btn-sm">Vider les lignes de plus de 7 jours</button></form></div>
<table class="dzf-table"><tr><th>Quand</th><th>Bloc</th><th></th><th>Durée</th><th>Message</th></tr>
${rows.map((r) => `<tr class="${r.ok ? "" : "dzf-bad"}"><td>${esc(new Date(r.quand).toLocaleString("fr-FR"))}</td><td><code>${esc(r.bloc)}</code></td><td>${r.ok ? "✓" : "✗"}</td><td>${r.duree_ms ?? ""} ms</td><td>${esc(r.message || "")}</td></tr>`).join("") || '<tr><td colspan="5" class="dzf-muted">Rien à signaler.</td></tr>'}</table>`);
};
const purge = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { journal } = await ensureTables();
  await journal.deleteRows({ quand: { lt: new Date(Date.now() - 7 * 864e5) } });
  go(res, "/dysizz-flow/journal", "Journal nettoyé");
};

module.exports = { allBlocks, csrf, restore, page, go, hidden, flash, library, blockPage, tryBlock, workshop, editor, save, remove, copyBuiltin, exportBlocks, importBlocks, templates, installTpl, journalPage, purge };
