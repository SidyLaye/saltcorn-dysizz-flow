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
const admin2 = require("./admin2");
const expose = require("./expose");
const { registerExternal } = require("./registry");
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
  /* + les blocs apportés par d'autres plugins (export dysizz_flow_blocks) */
  onLoad: async () => {
    try { registerExternal(); } catch (e) { /* rien */ }
    try { await registerUserBlocks(); } catch (e) { /* table pas encore créée : normal au 1er démarrage */ }
  },
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
    { url: "/dysizz-flow/atelier/restaurer", method: "post", callback: admin.restore },
    { url: "/dysizz-flow/api", method: "get", callback: withAssets(admin2.apiPage) },
    { url: "/dysizz-flow/api/save", method: "post", callback: admin2.apiSave },
    { url: "/dysizz-flow/api/delete", method: "post", callback: admin2.apiDelete },
    { url: "/dysizz-flow/coffre", method: "get", callback: withAssets(admin2.vaultPage) },
    { url: "/dysizz-flow/coffre/save", method: "post", callback: admin2.vaultSave },
    { url: "/dysizz-flow/coffre/delete", method: "post", callback: admin2.vaultDelete },
    { url: "/dysizz-flow/supervision", method: "get", callback: withAssets(admin2.monitorPage) },
    /* exposition publique : pas de jeton CSRF (appelé par d'autres services), protégé par jeton / signature.
       Saltcorn compare les routes sans CSRF par préfixe : d'où l'entrée « /dzf/api/ ». */
    { url: "/dzf/api/", method: "post", noCsrf: true, callback: (req, res) => res.status(404).json({ erreur: "introuvable" }) },
    { url: "/dzf/api/:nom", method: "post", noCsrf: true, callback: expose.handle },
    { url: "/dzf/api/:nom", method: "get", callback: expose.handle },
    { url: "/dysizz-flow/journal", method: "get", callback: withAssets(admin.journalPage) },
    { url: "/dysizz-flow/journal/vider", method: "post", callback: admin.purge },
    { url: "/dysizz-flow/a/:ver/:file", method: "get", callback: serveAsset },
  ],
};
