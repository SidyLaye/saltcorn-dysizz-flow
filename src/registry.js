/* Extensions : n'importe quel autre plugin Saltcorn peut apporter ses blocs.
   Il lui suffit d'exporter, en plus du reste :

     dysizz_flow_blocks: [
       { name: "dzx_monbloc", label: "…", category: "Extensions", icon: "fas fa-puzzle-piece",
         description: "…", output: "sortie",
         params: [{ name: "x", label: "X", type: "int", default: 1 }],
         run: async (params, contexte, api) => { … return valeur; } },
     ]

   Au démarrage, dysizz-flow les trouve, les vérifie et en fait des actions
   Saltcorn avec les mêmes avantages que ses blocs intégrés : {{variables}},
   essais, délai max, journal, métriques, secrets (api.secret). Les noms
   doivent commencer par « dzx_ » (pour ne jamais écraser un bloc intégré). */
"use strict";
const { toAction } = require("./engine");
const { PLUGIN } = require("./core");

const EXT_RE = /^dzx_[a-z0-9_]{2,50}$/;
let EXTERNAL = [];

const valid = (b) => b && EXT_RE.test(b.name || "") && typeof b.run === "function" && b.label && Array.isArray(b.params || []);

const scanPlugins = () => {
  let st;
  try { st = require("@saltcorn/data/db/state").getState(); } catch (e) { return []; }
  if (!st || !st.plugins) return [];
  const found = [];
  for (const [pname, plugin] of Object.entries(st.plugins)) {
    if (pname === PLUGIN || !plugin) continue;
    let list = plugin.dysizz_flow_blocks;
    try { if (typeof list === "function") list = list(); } catch (e) { list = null; }
    if (!Array.isArray(list)) continue;
    const { CATEGORIES } = require("./blocks");
    for (const b of list) if (valid(b)) found.push({ ...b, category: CATEGORIES.includes(b.category) && b.category !== "Mes blocs" ? b.category : "Extensions", icon: b.icon || "fas fa-puzzle-piece", description: b.description || "", output: b.output || b.name.slice(4), plugin: pname, external: true });
  }
  return found;
};

const registerExternal = () => {
  let st;
  try { st = require("@saltcorn/data/db/state").getState(); } catch (e) { return 0; }
  if (!st || !st.actions) return 0;
  EXTERNAL = scanPlugins();
  for (const b of EXTERNAL) st.actions[b.name] = toAction(b);
  return EXTERNAL.length;
};
const externalBlocks = () => EXTERNAL;

module.exports = { registerExternal, externalBlocks, scanPlugins, EXT_RE };
