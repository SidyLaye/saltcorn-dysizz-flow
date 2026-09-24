/* Les modèles de workflows n'utilisent que des blocs qui existent, et leurs étapes s'enchaînent. */
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { TEMPLATES, fill } = require("../src/templates/install");
const { BLOCKS } = require("../src/blocks");
const known = new Set([...BLOCKS.map((b) => b.name), "ForLoop", "SetContext", "TableQuery", "UserForm", "Output", "WaitUntil", "run_js_code"]);
const keys = new Set();
for (const t of TEMPLATES) {
  assert(!keys.has(t.key), t.key); keys.add(t.key);
  const names = new Set(t.steps.map((s) => s.name));
  for (const s of t.steps) {
    assert(known.has(s.action_name), `${t.key} : bloc inconnu ${s.action_name}`);
    const b = BLOCKS.find((x) => x.name === s.action_name);
    if (b) for (const k of Object.keys(s.configuration)) assert(["sortie", "si_erreur", "delai_max", "journaliser", "essais", "pause_essais"].includes(k) || (b.params || []).some((p) => p.name === k), `${t.key}.${s.name} : réglage ${k} inconnu pour ${b.name}`);
    if (s.next_step && !s.next_step.includes("?")) assert(names.has(s.next_step), `${t.key}.${s.name} → ${s.next_step}`);
  }
  const vars = Object.fromEntries((t.vars || []).map((v) => [v.name, v.default || "x"]));
  const filled = JSON.stringify(fill(t.steps, vars));
  assert(!/%%\w+%%/.test(filled), `${t.key} : variable non remplie`);
}
console.log(`modèles OK : ${TEMPLATES.length}`);
