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
const editor = require("./editor");
const { dysizz_hub } = require("./hub");
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
  /* petit script (1 Ko) : sur les pages natives des workflows, un bouton vers l'éditeur visuel */
  headers: [{ script: `/dysizz-flow/a/${VERSION}/hook.js`, defer: true }],
  /* pour les autres plugins (ex. Me) : ranger un secret dans le coffre, savoir s'il existe */
  dysizz_flow_api: {
    writeSecret: (nom, valeur, note) => require("./vault").writeSecret(nom, valeur, note),
    /* variable d'environnement lisible par ce tenant (règles de src/garde.js), sinon undefined */
    lireEnv: (nom) => require("./garde").lireEnv(nom),
    hasSecret: async (nom) => { try { return (await require("./vault").readSecret(nom)) !== undefined; } catch (e) { return false; } },
    /* CRM dont les secrets sont lus dans l'environnement puis le coffre (jamais renvoyés à l'appelant) */
    crmDepuisCoffre: (type, reglages, prefixe, mode) => {
      const pre = String(prefixe || "LEADS_CRM").replace(/[^\w]/g, "");
      const secret = async (k) => { const n = `${pre}_${String(k).toUpperCase()}`; try { return await require("./garde").lireSecret(n); } catch (e) { return undefined; } };
      return require("./lib/leads/crm").creerCrm(type, { ...(reglages || {}), secret }, { mode });
    },
    /* client IA dont la clé est lue dans l'environnement puis le coffre (jamais renvoyée) ;
       fournisseur « saltcorn » = le plugin large-language-model déjà réglé, sans clé à ranger ici */
    iaDepuisCoffre: (fournisseur, modele, nomCle, url) => {
      const G = globalThis[Symbol.for("dysizz-flow.ia-cache")] || (globalThis[Symbol.for("dysizz-flow.ia-cache")] = new Map());
      let t = "public"; try { t = require("@saltcorn/data/db").getTenantSchema(); } catch (e) { /* hors Saltcorn */ }
      const ck = JSON.stringify([t, fournisseur, modele, nomCle || "LEADS_IA_CLE", url || ""]);
      const cache = G.get(ck) || new Map(); G.set(ck, cache);
      const IA = require("./lib/leads/ia");
      if (fournisseur === "saltcorn") return IA.creer({ fournisseur, cache });
      const n = String(nomCle || "LEADS_IA_CLE").replace(/[^\w]/g, "");
      let client = null;
      return { fournisseur, lire: async (mail, texte) => {
        if (!client) { let k; try { k = await require("./garde").lireSecret(n); } catch (e) { k = undefined; } if (!k) throw new Error(`clé d'IA absente (${n})`); client = IA.creer({ fournisseur, modele, url, cle: k, cache }); }
        return client.lire(mail, texte);
      } };
    },
    /* compare une valeur reçue (en-tête d'un webhook…) à un secret, à temps constant, sans jamais le renvoyer */
    secretEgal: async (nom, valeur) => {
      let v; try { v = await require("./garde").lireSecret(nom); } catch (e) { v = undefined; }
      if (!v || valeur == null) return false;
      const a = Buffer.from(String(v)), b = Buffer.from(String(valeur));
      return a.length === b.length && require("crypto").timingSafeEqual(a, b);
    },
    /* un plugin qui apporte des blocs (dysizz_flow_blocks) les fait enregistrer à son chargement */
    enregistrerBlocsExternes: () => registerExternal(),
    /* verrous partagés entre processus et serveurs (Postgres) */
    verrou: require("./lib/verrou"),
    /* moteur leads immobiliers (utilisé par dysizz-leads) */
    leads: require("./lib/leads"),
    /* écouteurs de boîtes mail */
    ecouteurs: { demarrerTous: () => require("./ecouteurs").demarrerTous(), etat: () => require("./ecouteurs").etat(), tableDest: (t) => require("./ecouteurs").tableDest(t) },
  },
  /* tuiles sur l'accueil Dysizz (/dysizz, fourni par dysizz-ui) */
  dysizz_hub,
  /* les blocs perso de l'atelier (table dzf_blocs) sont ajoutés au chargement */
  /* + les blocs apportés par d'autres plugins (export dysizz_flow_blocks) */
  onLoad: async () => {
    try { registerExternal(); } catch (e) { /* rien */ }
    /* les plugins qui apportent des blocs peuvent se charger APRÈS dysizz-flow : on repasse,
       puis on vérifie chaque minute qu'aucun bloc externe n'a disparu (rechargement des plugins) */
    for (const ms of [3000, 15000]) setTimeout(() => { try { registerExternal(); } catch (e) { /* rien */ } }, ms).unref?.();
    const G = globalThis[Symbol.for("dysizz-flow.blocs-externes")] || (globalThis[Symbol.for("dysizz-flow.blocs-externes")] = {});
    if (!G.minuteur) G.minuteur = setInterval(() => { try { const st = require("@saltcorn/data/db/state").getState(); if (require("./registry").scanPlugins().some((b) => !st.actions[b.name])) registerExternal(); } catch (e) { /* rien */ } }, 60000);
    if (G.minuteur.unref) G.minuteur.unref();
    try { await registerUserBlocks(); } catch (e) { /* table pas encore créée : normal au 1er démarrage */ }
    try { await require("./ecouteurs").surveiller(); } catch (e) { /* rien */ }
  },
  /* événement émis par les écouteurs de boîtes mail : un workflow peut s'y abonner */
  eventTypes: { DzfMailRecu: { hasChannel: true } },
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
    { url: "/dysizz-flow/workflows", method: "get", callback: withAssets(editor.listPage) },
    { url: "/dysizz-flow/workflows/dupliquer", method: "post", callback: editor.duplicate },
    { url: "/dysizz-flow/workflows/supprimer", method: "post", callback: editor.remove },
    { url: "/dysizz-flow/editeur/:id", method: "get", callback: editor.editorPage },
    { url: "/dysizz-flow/editeur-api/fields/:action", method: "get", callback: editor.apiFields },
    { url: "/dysizz-flow/editeur-api/save", method: "post", callback: editor.apiSave },
    { url: "/dysizz-flow/editeur-api/run", method: "post", callback: editor.apiRun },
    { url: "/dysizz-flow/atelier/restaurer", method: "post", callback: admin.restore },
    { url: "/dysizz-flow/api", method: "get", callback: withAssets(admin2.apiPage) },
    { url: "/dysizz-flow/api/save", method: "post", callback: admin2.apiSave },
    { url: "/dysizz-flow/api/delete", method: "post", callback: admin2.apiDelete },
    { url: "/dysizz-flow/ecouteurs", method: "get", callback: withAssets(admin2.ecoutePage) },
    { url: "/dysizz-flow/ecouteurs/save", method: "post", callback: admin2.ecouteSave },
    { url: "/dysizz-flow/ecouteurs/delete", method: "post", callback: admin2.ecouteDelete },
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
