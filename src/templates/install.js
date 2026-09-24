/* Installe un modèle de workflow : crée un déclencheur « Workflow » et ses étapes. */
"use strict";
const TEMPLATES = require("./index");

const fill = (v, vars) => {
  if (typeof v === "string") return v.replace(/%%(\w+)%%/g, (_, k) => (vars[k] ?? ""));
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)]));
  return v;
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
  for (const v of t.vars || []) if (/^table/.test(v.name) && vars[v.name] && !Table.findOne({ name: vars[v.name] })) throw new Error(`la table « ${vars[v.name]} » n'existe pas`);
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
  return { name, trigger_id, steps: steps.length };
};

module.exports = { installTemplate, TEMPLATES, fill };
