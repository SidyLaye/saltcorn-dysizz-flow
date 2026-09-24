/* Installe un modèle de workflow : crée un déclencheur « Workflow » et ses étapes. */
"use strict";
const TEMPLATES = require("./index");

const fill = (v, vars) => {
  if (typeof v === "string") return v.replace(/%%(\w+)%%/g, (_, k) => (vars[k] ?? ""));
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)]));
  return v;
};

/* tables que le modèle peut créer tout seul si elles n'existent pas (pour ne pas
   obliger à passer par Saltcorn avant de pouvoir essayer) */
const S = (n, t, o) => [n, t, o || {}];
const SCHEMAS = {
  "rss_vers_table.table_sources": [S("nom", "String"), S("url", "String"), S("chaine", "String"), S("categorie", "String"), S("actif", "Bool")],
  "rss_vers_table.table_articles": [S("titre", "String"), S("url", "String", { is_unique: true }), S("date", "Date"), S("resume", "String"), S("image", "String"), S("auteur", "String"), S("video_id", "String"), S("source", "String"), S("lu", "Bool")],
  "imap_vers_table.table_mails": [S("uid", "Integer"), S("message_id", "String", { is_unique: true }), S("dossier", "String"), S("de", "String"), S("de_nom", "String"), S("a", "String"), S("sujet", "String"), S("date", "Date"), S("extrait", "String"), S("corps", "String"), S("lu", "Bool")],
  "surveillance_sites.table_sites": [S("nom", "String"), S("url", "String", { is_unique: true }), S("actif", "Bool"), S("etat", "String"), S("ms", "Integer"), S("raison", "String"), S("verifie_le", "Date")],
  "veille_cve.table_cve": [S("cve", "String", { is_unique: true }), S("gravite", "String"), S("score", "Float"), S("resume", "String"), S("url", "String"), S("publiee", "Date")],
};
const createTable = async (name, fields) => {
  const Table = require("@saltcorn/data/models/table");
  const Field = require("@saltcorn/data/models/field");
  const t = await Table.create(name, { min_role_read: 1, min_role_write: 1 });
  for (const [n, type, o] of fields) await Field.create({ table: t, name: n, label: n.charAt(0).toUpperCase() + n.slice(1).replace(/_/g, " "), type, ...o });
  try { await require("@saltcorn/data/db/state").getState().refresh_tables(true); } catch (e) { /* rien */ }
};

const uniqueName = (base) => {
  const Trigger = require("@saltcorn/data/models/trigger");
  let n = base, i = 2;
  while (Trigger.findOne({ name: n })) n = `${base}_${i++}`;
  return n;
};

/* renvoie { trigger, steps } ; lève une erreur lisible si une table manque */
const installTemplate = async (key, input = {}) => {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error("modèle inconnu");
  const Trigger = require("@saltcorn/data/models/trigger");
  const WorkflowStep = require("@saltcorn/data/models/workflow_step");
  const Table = require("@saltcorn/data/models/table");
  const vars = Object.fromEntries((t.vars || []).map((v) => [v.name, input[v.name] !== undefined && input[v.name] !== "" ? String(input[v.name]) : v.default ?? ""]));
  const created = [];
  for (const v of t.vars || []) {
    if (!/^table/.test(v.name) || !vars[v.name] || Table.findOne({ name: vars[v.name] })) continue;
    const schema = SCHEMAS[`${t.key}.${v.name}`];
    if (schema && input.creer_tables !== "non") { await createTable(vars[v.name], schema); created.push(vars[v.name]); }
    else throw new Error(`la table « ${vars[v.name]} » n'existe pas${schema ? "" : " : crée-la d'abord dans Saltcorn (Tables → Créer)"}`);
  }
  const when = input.when || t.when;
  const table = t.tableVar ? Table.findOne({ name: vars[t.tableVar] }) : null;
  if (["Insert", "Update", "Delete"].includes(when) && !table) throw new Error("ce déclencheur a besoin d'une table");
  const name = uniqueName(input.nom || `dzf_${t.key}`);
  const trig = await Trigger.create({ name, action: "Workflow", when_trigger: when, table_id: table ? table.id : null, configuration: {}, min_role: 1, description: `${t.label} (modèle dysizz-flow)` });
  const trigger_id = trig.id || (Trigger.findOne({ name }) || {}).id;
  const steps = fill(t.steps, vars);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await WorkflowStep.create({ trigger_id, name: s.name, action_name: s.action_name, configuration: s.configuration, next_step: s.next_step || "", only_if: s.only_if || "", initial_step: i === 0 });
  }
  try { await require("@saltcorn/data/db/state").getState().refresh_triggers(true); } catch (e) { /* rien */ }
  return { name, trigger_id, steps: steps.length, created };
};

module.exports = { installTemplate, TEMPLATES, fill, SCHEMAS };
