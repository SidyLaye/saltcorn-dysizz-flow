/* =====================================================================
   Éditeur visuel de workflows (toile façon n8n) — côté serveur.
   Il lit et écrit les vrais workflows Saltcorn (déclencheur « Workflow » +
   étapes _sc_workflow_steps) : ce qui est fait ici se voit aussi dans
   l'éditeur natif, et inversement. Les positions des blocs sur la toile
   sont rangées dans trigger.configuration.dzf_layout.

   Tout se fait dans le navigateur, puis un seul enregistrement :
   pas d'aller-retour serveur à chaque touche (d'où l'absence de lag).
   ===================================================================== */
"use strict";
const { esc, isAdmin, denied, VERSION } = require("./core");
const { BLOCKS, CATEGORIES } = require("./blocks");
const { COMMON } = require("./engine");

const WHEN = [
  ["Never", "À la main (bouton, essai, autre workflow)"], ["Often", "Toutes les ~5 minutes"], ["Hourly", "Toutes les heures"], ["Daily", "Chaque jour"], ["Weekly", "Chaque semaine"],
  ["Insert", "Quand une ligne est ajoutée dans une table"], ["Update", "Quand une ligne est modifiée"], ["Delete", "Quand une ligne est supprimée"], ["API call", "Quand une adresse d'API est appelée"],
];
const TABLE_WHEN = ["Insert", "Update", "Delete", "Validate"];
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,60}$/;

/* étapes propres aux workflows Saltcorn, en français */
const BUILTIN = {
  ForLoop: ["Boucle : pour chaque élément", "fas fa-redo", "Répète un morceau du workflow pour chaque élément d'une liste"],
  SetContext: ["Définir des variables (Saltcorn)", "fas fa-equals", "Crée des variables à partir d'expressions JavaScript"],
  TableQuery: ["Lire une table (Saltcorn)", "fas fa-table", "Requête sur une table, rangée dans une variable"],
  UserForm: ["Poser des questions", "fas fa-question-circle", "Demande à un utilisateur de répondre, le workflow attend"],
  EditViewForm: ["Faire remplir un formulaire", "fas fa-edit", "Ouvre une vue Edit, le workflow attend la réponse"],
  Output: ["Afficher un message", "fas fa-comment-alt", "Montre un message, le workflow attend qu'il soit lu"],
  DataOutput: ["Afficher des données", "fas fa-th-list", "Montre une valeur ou un tableau"],
  OutputView: ["Afficher une vue", "fas fa-eye", "Montre le résultat d'une vue Saltcorn"],
  WaitUntil: ["Attendre jusqu'à", "fas fa-hourglass-half", "Met le workflow en pause jusqu'à une date"],
  WaitNextTick: ["Continuer en arrière-plan", "fas fa-forward", "Détache la suite du workflow"],
  SetErrorHandler: ["Si erreur, aller à", "fas fa-life-ring", "Choisit l'étape qui prend la main en cas d'erreur"],
  APIResponse: ["Répondre à l'appel d'API", "fas fa-reply", "La réponse renvoyée à qui a appelé le workflow"],
  TerminateWorkflow: ["Arrêter le workflow", "fas fa-stop-circle", "Termine tout de suite"],
};

/* libellés français des réglages des étapes natives */
const FR = {
  array_expression: ["Liste à parcourir", "Expression qui donne la liste, ex. nouveaux ou resultat.lignes"], item_variable: ["Nom de l'élément", "Dans la boucle, l'élément courant s'appelle ainsi, ex. item"],
  index_variable: ["Nom du numéro (facultatif)", "Le rang de l'élément, à partir de 0"], loop_body_initial_step: ["Première étape de la boucle", "Les étapes à répéter commencent ici"],
  form_header: ["Titre du formulaire", ""], user_id_expression: ["Qui doit répondre (id, expression)", "Vide = l'utilisateur qui lance"], edit_view: ["Vue Edit à remplir", ""], view: ["Vue à afficher", ""],
  view_state: ["État de la vue (expression)", "Ex. { id: ligne.id }"], response_variable: ["Ranger la réponse dans", ""], resume_at: ["Reprendre à (expression date)", "Ex. new Date(Date.now() + 3600e3)"],
  ctx_values: ["Valeurs (expression objet)", "Ex. { total: a + b }"], response_expression: ["Réponse (expression)", ""], return_value: ["Valeur renvoyée (expression)", ""],
  output_text: ["Message", "Tu peux utiliser {{variables}}"], output_expr: ["Valeur à afficher (expression)", ""], markdown: ["Message en Markdown", ""], immediately_bg: ["Tout de suite en arrière-plan", ""],
  wait_delay: ["Attendre (secondes)", ""], query_table: ["Table", ""], query_object: ["Filtre (objet)", "Ex. { statut: \"ouvert\" }"], error_handling_step: ["Étape en cas d'erreur", ""],
  query_variable: ["Ranger les lignes dans", ""], popup_title: ["Titre de la fenêtre", ""], user_form_questions: ["Questions", ""],
};
const st = () => require("@saltcorn/data/db/state").getState();
const json = (res, code, body) => { res.status(code); res.setHeader("Cache-Control", "no-store"); res.json(body); };

/* ---------- la palette : tous les blocs disponibles ---------- */
let PALETTE = null;
const palette = async () => {
  if (PALETTE && PALETTE.t > Date.now() - 60e3) return PALETTE.v;
  const { loadUserBlocks } = require("./userblocks");
  const { externalBlocks, registerExternal } = require("./registry");
  registerExternal();
  const mine = await loadUserBlocks().catch(() => []);
  const dz = [...BLOCKS, ...externalBlocks(), ...mine].map((b) => ({ name: b.name, label: b.label, category: b.category, icon: b.icon, description: b.description, output: b.output, dz: true }));
  const known = new Set(dz.map((b) => b.name));
  const builtin = Object.entries(BUILTIN).map(([name, [label, icon, description]]) => ({ name, label, icon, description, category: "Contrôle du workflow", builtin: true }));
  const others = Object.entries(st().actions || {}).filter(([n, a]) => !known.has(n) && !n.startsWith("dzf_") && a && !a.disableInWorkflow)
    .map(([name, a]) => ({ name, label: name.replace(/_/g, " "), icon: "fas fa-plug", description: String(a.description || "").slice(0, 200), category: "Actions Saltcorn et modules" }));
  const cats = [...CATEGORIES, "Extensions", "Contrôle du workflow", "Actions Saltcorn et modules"];
  const v = { categories: cats, blocks: [...dz, ...builtin, ...others] };
  PALETTE = { t: Date.now(), v };
  return v;
};

/* ---------- les réglages d'un bloc, sous une forme simple pour le formulaire ---------- */
const optList = async (o) => {
  if (!o) return null;
  if (typeof o === "function") o = await o();
  if (typeof o === "string") o = o.split(",").map((s) => s.trim());
  if (!Array.isArray(o)) return null;
  return o.map((x) => (x && typeof x === "object" ? { v: String(x.value ?? x.name ?? ""), l: String(x.label ?? x.name ?? x.value ?? "") } : { v: String(x), l: String(x) }));
};
const kindOf = (f) => {
  const t = typeof f.type === "string" ? f.type : f.type && f.type.name;
  if (f.fieldview === "code_editor" || f.input_type === "code") return f.attributes && /json/.test(f.attributes.mode || "") ? "json" : "code";
  if (f.fieldview === "textarea" || (f.attributes && f.attributes.rows)) return "text";
  if (f.fieldview === "password" || f.input_type === "password") return "password";
  if (t === "Bool") return "bool";
  if (t === "Integer" || t === "Float") return "number";
  if (f.input_type === "section_header") return "header";
  return "string";
};
const normField = async (f) => ({
  name: f.name, label: f.label || f.name, help: f.sublabel || "", required: !!f.required, def: f.default,
  kind: kindOf(f), options: await optList(f.options || (f.attributes && f.attributes.options)), showIf: f.showIf || null,
});

const fieldsFor = async (name, tableName) => {
  const Table = require("@saltcorn/data/models/table");
  const table = tableName ? Table.findOne({ name: tableName }) : null;
  const tableNames = async () => (await Table.find({})).map((t) => t.name).filter((n) => !/^_sc_/.test(n)).sort();
  let dz = BLOCKS.find((b) => b.name === name) || require("./registry").externalBlocks().find((b) => b.name === name);
  if (!dz && name.startsWith("dzf_u_")) dz = (await require("./userblocks").loadUserBlocks().catch(() => [])).find((b) => b.name === name);
  if (dz) {
    const kind = { int: "number", number: "number", bool: "bool", select: "select", table: "table", json: "json", code: "code", text: "text", password: "password" };
    const params = await Promise.all((dz.params || []).map(async (p) => ({
      name: p.name, label: p.label || p.name, help: p.help || "", required: !!p.required, def: p.default,
      kind: kind[p.type] || "string", options: p.type === "select" ? await optList(p.options) : p.type === "table" ? await optList(await tableNames()) : null, vars: !["bool", "select", "table"].includes(p.type),
    })));
    const common = await Promise.all(COMMON(dz).map(normField));
    return { dz: true, label: dz.label, description: dz.description, icon: dz.icon, output: dz.output, fields: params, advanced: common.map((c) => ({ ...c, vars: false })) };
  }
  if (BUILTIN[name]) {
    const WorkflowStep = require("@saltcorn/data/models/workflow_step");
    const all = await WorkflowStep.builtInActionConfigFields({});
    const mine = all.filter((f) => f.showIf && [].concat(f.showIf.wf_action_name || []).includes(name));
    return { builtin: true, label: BUILTIN[name][0], description: BUILTIN[name][2], icon: BUILTIN[name][1], fields: await Promise.all(mine.map(async (f) => { const n = await normField(f); const { wf_action_name, ...rest } = n.showIf || {}; const fr = FR[n.name]; return { ...n, ...(fr ? { label: fr[0], help: fr[1] || n.help } : {}), showIf: Object.keys(rest).length ? rest : null }; })) };
  }
  const a = (st().actions || {})[name];
  if (!a) return { unknown: true, fields: [] };
  let fs = [];
  try { fs = typeof a.configFields === "function" ? await a.configFields({ table, mode: "workflow" }) : a.configFields || []; } catch (e) { fs = []; }
  return { label: name, description: a.description || "", icon: "fas fa-plug", fields: await Promise.all((fs || []).filter((f) => f && f.name).map(normField)) };
};

/* ---------- lecture / écriture d'un workflow ---------- */
const loadWorkflow = async (id) => {
  const Trigger = require("@saltcorn/data/models/trigger");
  const WorkflowStep = require("@saltcorn/data/models/workflow_step");
  const Table = require("@saltcorn/data/models/table");
  const t = Trigger.findOne({ id: +id });
  if (!t || t.action !== "Workflow") return null;
  const steps = await WorkflowStep.find({ trigger_id: t.id });
  const table = t.table_id ? Table.findOne({ id: t.table_id }) : null;
  return {
    id: t.id, name: t.name, description: t.description || "", when_trigger: t.when_trigger, table: table ? table.name : "", channel: t.channel || "",
    layout: (t.configuration && t.configuration.dzf_layout) || {},
    steps: steps.map((s) => ({ id: s.id, name: s.name, action_name: s.action_name, configuration: s.configuration || {}, next_step: s.next_step || "", only_if: s.only_if || "", initial_step: !!s.initial_step })),
  };
};

const saveWorkflow = async (body) => {
  const Trigger = require("@saltcorn/data/models/trigger");
  const WorkflowStep = require("@saltcorn/data/models/workflow_step");
  const Table = require("@saltcorn/data/models/table");
  const name = String(body.name || "").trim();
  if (!name || name.length > 80) throw new Error("donne un nom au workflow");
  const when = WHEN.some(([w]) => w === body.when_trigger) || body.when_trigger === "Validate" ? body.when_trigger : "Never";
  const table = body.table ? Table.findOne({ name: body.table }) : null;
  if (TABLE_WHEN.includes(when) && !table) throw new Error("choisis la table qui déclenche le workflow");
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const names = new Set();
  for (const s of steps) {
    if (!NAME_RE.test(s.name || "")) throw new Error(`nom d'étape invalide : « ${s.name} » (lettres, chiffres, _)`);
    if (names.has(s.name)) throw new Error(`deux étapes s'appellent « ${s.name} »`);
    names.add(s.name);
    if (!s.action_name) throw new Error(`l'étape « ${s.name} » n'a pas de bloc`);
  }
  if (steps.length && steps.filter((s) => s.initial_step).length !== 1) throw new Error("il faut exactement une première étape (relie-la au déclencheur)");
  const other = Trigger.findOne({ name });
  if (other && other.id !== +body.id) throw new Error(`un autre événement s'appelle déjà « ${name} »`);
  let trig;
  const layout = body.layout && typeof body.layout === "object" ? body.layout : {};
  if (body.id) {
    trig = Trigger.findOne({ id: +body.id });
    if (!trig || trig.action !== "Workflow") throw new Error("workflow introuvable");
    await Trigger.update(trig.id, { name, description: String(body.description || "").slice(0, 500), when_trigger: when, table_id: table ? table.id : null, configuration: { ...(trig.configuration || {}), dzf_layout: layout } });
  } else {
    trig = await Trigger.create({ name, action: "Workflow", when_trigger: when, table_id: table ? table.id : null, description: String(body.description || "").slice(0, 500), configuration: { dzf_layout: layout }, min_role: 1 });
    if (!trig.id) trig = Trigger.findOne({ name });
  }
  const existing = await WorkflowStep.find({ trigger_id: trig.id });
  const keep = new Set(steps.filter((s) => s.id).map((s) => +s.id));
  for (const ex of existing) if (!keep.has(ex.id)) await ex.delete();
  for (const s of steps) {
    const row = { name: s.name, action_name: s.action_name, configuration: s.configuration || {}, next_step: String(s.next_step || ""), only_if: String(s.only_if || ""), initial_step: !!s.initial_step };
    const ex = s.id && existing.find((e) => e.id === +s.id);
    if (ex) await ex.update(row); else await WorkflowStep.create({ trigger_id: trig.id, ...row });
  }
  try { await st().refresh_triggers(true); } catch (e) { /* rien */ }
  try { st().processSend({ refresh: "triggers", tenant: require("@saltcorn/data/db").getTenantSchema() }); } catch (e) { /* un seul processus */ }
  return loadWorkflow(trig.id);
};

/* ---------- pages ---------- */
const listPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const { page, hidden } = require("./admin");
  const Trigger = require("@saltcorn/data/models/trigger");
  const Table = require("@saltcorn/data/models/table");
  const WF = Trigger.find({ action: "Workflow" }).sort((a, b) => a.name.localeCompare(b.name));
  let runs = [];
  try { runs = await require("@saltcorn/data/models/workflow_run").find({ started_at: { gt: new Date(Date.now() - 7 * 864e5) } }, { orderBy: "id", orderDesc: true, limit: 3000 }); } catch (e) { runs = []; }
  const last = new Map();
  const errs = new Map();
  for (const r of runs) { if (!last.has(r.trigger_id)) last.set(r.trigger_id, r); if (r.status === "Error") errs.set(r.trigger_id, (errs.get(r.trigger_id) || 0) + 1); }
  const WS = require("@saltcorn/data/models/workflow_step");
  const counts = new Map();
  for (const s of await WS.find({})) counts.set(s.trigger_id, (counts.get(s.trigger_id) || 0) + 1);
  const whenL = Object.fromEntries(WHEN);
  const card = (t) => {
    const r = last.get(t.id);
    const tb = t.table_id ? (Table.findOne({ id: t.table_id }) || {}).name : "";
    const e = errs.get(t.id) || 0;
    return `<div class="dzf-wf" data-search="${esc((t.name + " " + (t.description || "")).toLowerCase())}">
<a class="dzf-wf-main" href="/dysizz-flow/editeur/${t.id}"><span class="dzf-wf-ic"><i class="fas fa-project-diagram"></i></span>
<span><b>${esc(t.name)}</b><small>${esc(t.description || "")}</small>
<span class="dzf-wf-meta"><span><i class="far fa-clock"></i> ${esc(whenL[t.when_trigger] || t.when_trigger)}${tb ? ` · ${esc(tb)}` : ""}</span><span>${counts.get(t.id) || 0} étape(s)</span>
${r ? `<span class="${r.status === "Error" ? "ko" : "ok"}">${r.status === "Error" ? "dernière exécution en erreur" : "dernière exécution " + esc(new Date(r.started_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span>` : '<span class="mute">jamais lancé</span>'}
${e ? `<span class="ko">${e} erreur(s) sur 7 j</span>` : ""}</span></span></a>
<div class="dzf-wf-actions"><a class="btn btn-sm btn-primary" href="/dysizz-flow/editeur/${t.id}"><i class="fas fa-pen"></i> Ouvrir</a>
<form method="post" action="/dysizz-flow/workflows/dupliquer">${hidden(req)}<input type="hidden" name="id" value="${t.id}"><button class="btn btn-sm btn-outline-secondary" title="Dupliquer"><i class="far fa-copy"></i></button></form>
<form method="post" action="/dysizz-flow/workflows/supprimer" onsubmit="return confirm('Supprimer le workflow « ${esc(t.name).replace(/'/g, "\\'")} » ?')">${hidden(req)}<input type="hidden" name="id" value="${t.id}"><button class="btn btn-sm btn-outline-danger" title="Supprimer"><i class="far fa-trash-alt"></i></button></form></div></div>`;
  };
  page(res, req, "Workflows", "workflows", `
<div class="dzf-head"><div><h1>Workflows</h1><p>Tes automatismes. Ouvre-en un pour le voir en schéma et le modifier : des blocs reliés par des flèches, un formulaire simple pour chaque bloc, et le code si tu le veux.</p></div>
<div class="dzf-actions"><a class="btn btn-outline-primary" href="/dysizz-flow/modeles"><i class="fas fa-magic"></i> Partir d'un modèle</a><a class="btn btn-primary" href="/dysizz-flow/editeur/nouveau"><i class="fas fa-plus"></i> Nouveau workflow</a></div></div>
<input class="form-control dzf-search" placeholder="Chercher un workflow…" oninput="dzfSearchWf(this.value)">
<div class="dzf-wfs">${WF.map(card).join("") || '<div class="dzf-empty"><i class="fas fa-project-diagram"></i><p>Pas encore de workflow.</p><a class="btn btn-primary" href="/dysizz-flow/modeles">Voir les modèles prêts à l\'emploi</a></div>'}</div>`);
};

const editorPage = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const Table = require("@saltcorn/data/models/table");
  let wf = req.params.id === "nouveau" ? { id: null, name: "", description: "", when_trigger: "Never", table: "", layout: {}, steps: [] } : await loadWorkflow(req.params.id);
  if (!wf) return res.redirect("/dysizz-flow/workflows");
  const boot = {
    wf, when: WHEN, tableWhen: TABLE_WHEN, tables: (await Table.find({})).map((t) => ({ name: t.name, fields: t.getFields().map((f) => f.name) })).filter((t) => !/^_sc_/.test(t.name)),
    palette: await palette(), csrf: req.csrfToken ? req.csrfToken() : "", version: VERSION,
  };
  /* dans le JSON : « < » et « {{ » écrits en \\u pour que ni le HTML ni Saltcorn ne les interprètent */
  const data = JSON.stringify(boot).replace(/</g, "\\u003c").replace(/\{\{/g, "\\u007b\\u007b");
  res.sendWrap({ title: wf.name ? `Workflow ${wf.name}` : "Nouveau workflow", requestFluidLayout: true, headers: [{ css: `/dysizz-flow/a/${VERSION}/editeur.css` }, { script: `/dysizz-flow/a/${VERSION}/editeur.js`, defer: true }] }, {
    above: [{ type: "blank", isHTML: true, contents: `<div id="dzfe" class="dzfe"><div class="dzfe-loading">Chargement de l'éditeur…</div></div><script type="application/json" id="dzfe-data">${data}</script>` }],
  });
};

/* ---------- API de l'éditeur (JSON) ---------- */
const apiFields = async (req, res) => {
  if (!isAdmin(req)) return json(res, 403, { error: "réservé aux admins" });
  try { json(res, 200, await fieldsFor(req.params.action, req.query.table)); } catch (e) { json(res, 200, { error: e.message, fields: [] }); }
};
const apiSave = async (req, res) => {
  if (!isAdmin(req)) return json(res, 403, { error: "réservé aux admins" });
  try { json(res, 200, { ok: true, wf: await saveWorkflow(req.body || {}) }); } catch (e) { json(res, 200, { error: e.message }); }
};
const apiRun = async (req, res) => {
  if (!isAdmin(req)) return json(res, 403, { error: "réservé aux admins" });
  const Trigger = require("@saltcorn/data/models/trigger");
  const WorkflowRun = require("@saltcorn/data/models/workflow_run");
  const b = req.body || {};
  const t = Trigger.findOne({ id: +b.id });
  if (!t) return json(res, 200, { error: "enregistre d'abord le workflow" });
  let ctx = {};
  try { ctx = typeof b.contexte === "string" ? JSON.parse(b.contexte || "{}") : b.contexte || {}; } catch (e) { return json(res, 200, { error: `contexte JSON invalide : ${e.message}` }); }
  const t0 = Date.now();
  const run = await WorkflowRun.create({ trigger_id: t.id, context: ctx, started_by: req.user.id });
  try {
    await run.run({ user: req.user, req, interactive: false, trace: true });
    const after = await WorkflowRun.findOne({ id: run.id });
    json(res, 200, { ok: after.status !== "Error", status: after.status, error: after.error || "", step: after.current_step, context: after.context, ms: Date.now() - t0, run_id: run.id });
  } catch (e) {
    const after = await WorkflowRun.findOne({ id: run.id }).catch(() => null);
    json(res, 200, { ok: false, status: "Error", error: e.message, step: after && after.current_step, context: after && after.context, ms: Date.now() - t0, run_id: run.id });
  }
};
const duplicate = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const wf = await loadWorkflow((req.body || {}).id);
  if (!wf) return res.redirect("/dysizz-flow/workflows");
  const Trigger = require("@saltcorn/data/models/trigger");
  let n = `${wf.name}_copie`, i = 2;
  while (Trigger.findOne({ name: n })) n = `${wf.name}_copie${i++}`;
  const copy = await saveWorkflow({ ...wf, id: null, name: n, when_trigger: "Never", steps: wf.steps.map((s) => ({ ...s, id: null })) });
  res.redirect(`/dysizz-flow/editeur/${copy.id}`);
};
const remove = async (req, res) => {
  if (!isAdmin(req)) return denied(res);
  const Trigger = require("@saltcorn/data/models/trigger");
  const t = Trigger.findOne({ id: +(req.body || {}).id });
  if (t && t.action === "Workflow") await t.delete();
  res.redirect("/dysizz-flow/workflows");
};

module.exports = { listPage, editorPage, apiFields, apiSave, apiRun, duplicate, remove, palette, loadWorkflow, saveWorkflow, fieldsFor, WHEN };
