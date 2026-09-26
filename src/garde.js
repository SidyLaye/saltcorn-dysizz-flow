/* Garde-fous multi-tenant.
   Un admin de tenant n'est pas forcément l'admin du serveur (client, associé,
   utilisateur d'un SaaS). Deux règles, alignées sur celles de Saltcorn :

   1. Variables d'environnement lues par leur nom (secrets des blocs, points
      d'API, écouteurs, CRM) :
      - les secrets du serveur ne sont JAMAIS lisibles (base, sessions, coffre, Redis) ;
      - tenant racine : toutes les autres ;
      - autre tenant : seulement celles listées dans DZF_ENV_PARTAGEES
        (réglée sur le serveur, ex. « OPENAI_API_KEY,GOTENBERG_URL »).
        Sinon, le tenant range ses secrets dans son propre coffre.

   2. Conditions et expressions JavaScript écrites dans les blocs :
      - tenant racine : exécutées directement (rapide) ;
      - autre tenant : dans le bac à sable des formules Saltcorn
        (eval_expression, vm2), sans accès au serveur. */
"use strict";

const INTERDITES = /^(PG[A-Z0-9_]*|POSTGRES_[A-Z0-9_]*|DATABASE_URL|SALTCORN_[A-Z0-9_]*|DZF_CLE_COFFRE|DZF_ENV_PARTAGEES|REDIS_URL|REDIS_PASSWORD|NODE_OPTIONS)$/i;

/* Tenant racine ? Hors Saltcorn (tests), il n'y a qu'un tenant : oui.
   Si Saltcorn répond mal, on considère que non (on ferme plutôt qu'ouvrir). */
const estRacine = () => {
  let db;
  try { db = require("@saltcorn/data/db"); } catch (e) { return false; }
  if (!db || typeof db.getTenantSchema !== "function") return true;
  try { return db.getTenantSchema() === (db.connectObj && db.connectObj.default_schema); } catch (e) { return false; }
};

const partagees = () => new Set(String(process.env.DZF_ENV_PARTAGEES || "").split(",").map((s) => s.trim()).filter(Boolean));

/* pourquoi une variable est refusée (null si elle est lisible) */
const refusEnv = (nom) => {
  const n = String(nom || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(n)) return "nom de variable invalide";
  if (INTERDITES.test(n)) return "secret du serveur, jamais lisible depuis un workflow";
  if (!estRacine() && !partagees().has(n)) return "variable non partagée avec ce tenant (DZF_ENV_PARTAGEES)";
  return null;
};

/* la valeur si la règle l'autorise, sinon undefined (comme une variable absente) */
const lireEnv = (nom) => (nom && !refusEnv(nom) ? process.env[nom] : undefined);

/* secret : variable d'environnement autorisée d'abord, sinon le coffre du tenant */
const lireSecret = async (nom) => {
  if (!nom) return undefined;
  const v = lireEnv(nom);
  if (v) return v;
  return require("./vault").readSecret(nom);
};

/* Compile une expression JavaScript : renvoie f(...valeurs), dans l'ordre de `noms`. */
const compiler = (expr, noms) => {
  const code = String(expr == null ? "" : expr);
  let direct;
  try { direct = new Function(...noms, `"use strict"; return (${code});`); } catch (e) { throw new Error(`expression invalide : ${e.message}`); }
  if (estRacine()) return direct;
  const { eval_expression } = require("@saltcorn/data/models/expression");
  /* compilée une seule fois dans le bac à sable, puis appelée pour chaque élément */
  const f = eval_expression(`(${noms.join(", ")}) => (${code})`, {}, undefined, "dysizz-flow");
  if (typeof f !== "function") throw new Error("expression invalide");
  return f;
};

module.exports = { estRacine, refusEnv, lireEnv, lireSecret, compiler, INTERDITES };
