/* =====================================================================
   dysizz-flow — plugin Saltcorn (point d'entrée)
   Le fichier index.js à la racine du dépôt est GÉNÉRÉ depuis src/ par
   tools/build.mjs : ne pas le modifier à la main.
   ===================================================================== */
"use strict";
const { PLUGIN, VERSION } = require("./core");
const { toAction } = require("./engine");
const { BLOCKS } = require("./blocks");
const { registerUserBlocks } = require("./userblocks");
const admin = require("./admin");
const { ASSETS } = require("./generated/assets");

const TYPES = { css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8" };
const serveAsset = (req, res) => {
  const a = ASSETS[req.params.file];
  if (!a) return res.status(404).send("");
  res.removeHeader && res.removeHeader("Set-Cookie");
  res.setHeader("Content-Type", TYPES[req.params.file.split(".").pop()]);
  res.setHeader("Cache-Control", req.params.ver === VERSION ? "public, max-age=31536000, immutable" : "public, max-age=300");
  res.end(a.src);
};

/* les pages d'admin chargent leur CSS et leur script, et rien d'autre ailleurs */
const withAssets = (fn) => (req, res) => {
  const send = res.sendWrap.bind(res);
  res.sendWrap = (opts, ...rest) => send({ ...opts, headers: [...(opts.headers || []), { css: `/dysizz-flow/a/${VERSION}/dzf.css` }, { script: `/dysizz-flow/a/${VERSION}/dzf.js`, defer: true }] }, ...rest);
  return fn(req, res);
};

const ACTIONS = Object.fromEntries(BLOCKS.map((b) => [b.name, toAction(b)]));

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: PLUGIN,
  /* pas de configuration_workflow : Saltcorn lit alors des valeurs, pas des fonctions */
  actions: ACTIONS,
  /* les blocs perso de l'atelier (table dzf_blocs) sont ajoutés au chargement */
  onLoad: async () => { try { await registerUserBlocks(); } catch (e) { /* table pas encore créée : normal au 1er démarrage */ } },
  routes: [
    { url: "/dysizz-flow", method: "get", callback: withAssets(admin.library) },
    { url: "/dysizz-flow/bloc/:name", method: "get", callback: withAssets(admin.blockPage) },
    { url: "/dysizz-flow/essayer", method: "post", callback: admin.tryBlock },
    { url: "/dysizz-flow/atelier", method: "get", callback: withAssets(admin.workshop) },
    { url: "/dysizz-flow/atelier/export", method: "get", callback: admin.exportBlocks },
    { url: "/dysizz-flow/atelier/import", method: "post", callback: admin.importBlocks },
    { url: "/dysizz-flow/atelier/save", method: "post", callback: admin.save },
    { url: "/dysizz-flow/atelier/delete", method: "post", callback: admin.remove },
    { url: "/dysizz-flow/atelier/copier", method: "post", callback: admin.copyBuiltin },
    { url: "/dysizz-flow/atelier/:nom", method: "get", callback: withAssets(admin.editor) },
    { url: "/dysizz-flow/modeles", method: "get", callback: withAssets(admin.templates) },
    { url: "/dysizz-flow/modeles/:key", method: "post", callback: admin.installTpl },
    { url: "/dysizz-flow/journal", method: "get", callback: withAssets(admin.journalPage) },
    { url: "/dysizz-flow/journal/vider", method: "post", callback: admin.purge },
    { url: "/dysizz-flow/a/:ver/:file", method: "get", callback: serveAsset },
  ],
};
