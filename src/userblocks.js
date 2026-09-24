/* Tes blocs perso (atelier) : rangés dans la table dzf_blocs, ils deviennent de
   vraies actions Saltcorn « dzf_u_<nom> », avec leur formulaire de réglages,
   utilisables dans l'éditeur de workflows comme les blocs intégrés.
   Leur code tourne dans le bac à sable de Saltcorn (comme run_js_code) :
   « params » contient les réglages, « row » le contexte du workflow. */
"use strict";
const { toAction } = require("./engine");
const { ensureTables } = require("./store");
const { PLUGIN } = require("./core");

const PREFIX = "dzf_u_";
const NAME_RE = /^[a-z][a-z0-9_]{1,40}$/;

const fromRow = (r) => {
  let params = [];
  try { params = JSON.parse(r.params || "[]"); } catch (e) { params = []; }
  const code = r.code || "return null;";
  return {
    name: PREFIX + r.nom, label: r.libelle || r.nom, category: "Mes blocs", icon: r.icone || "fas fa-cube", description: r.description || "Bloc perso",
    params, output: r.sortie || r.nom, custom: true, code, row: r,
    run: async (p, ctx, api) => {
      const { getState } = require("@saltcorn/data/db/state");
      const js = getState().actions.run_js_code;
      /* le contexte + les réglages résolus ; ce que le code renvoie devient la sortie */
      return js.run({ configuration: { code, run_where: "Server" }, row: { ...ctx, params: p }, user: api.user, req: api.req, mode: "workflow" });
    },
  };
};

const loadUserBlocks = async () => {
  const { blocs } = await ensureTables();
  return (await blocs.getRows({ actif: true }, { orderBy: "nom" })).map(fromRow);
};

/* inscrit les blocs perso dans les actions de Saltcorn (ce processus, ce tenant) */
const registerUserBlocks = async () => {
  const { getState } = require("@saltcorn/data/db/state");
  const st = getState();
  if (!st || !st.actions) return 0;
  const list = await loadUserBlocks();
  for (const k of Object.keys(st.actions)) if (k.startsWith(PREFIX)) delete st.actions[k];
  for (const b of list) st.actions[b.name] = toAction(b);
  return list.length;
};

/* après un enregistrement : ici tout de suite, et les autres processus / serveurs via Saltcorn */
const broadcast = async () => {
  await registerUserBlocks();
  try {
    const db = require("@saltcorn/data/db");
    require("@saltcorn/data/db/state").getState().processSend({ refresh_plugin_cfg: PLUGIN, tenant: db.getTenantSchema() });
  } catch (e) { /* un seul processus : rien à prévenir */ }
};

module.exports = { loadUserBlocks, registerUserBlocks, broadcast, fromRow, PREFIX, NAME_RE };
