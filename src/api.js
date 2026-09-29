/* API de dysizz-flow pour les autres plugins et pour ses propres solutions (Leads…) :
   secrets, CRM, IA, verrous, moteur leads, écouteurs. Jamais un secret n'est renvoyé. */
"use strict";
const { registerExternal } = require("./registry");

module.exports = {
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
    /* moteur leads immobiliers */
    leads: require("./lib/leads"),
    /* écouteurs de boîtes mail */
    ecouteurs: { demarrerTous: () => require("./ecouteurs").demarrerTous(), etat: () => require("./ecouteurs").etat(), tableDest: (t) => require("./ecouteurs").tableDest(t) },
  
};
