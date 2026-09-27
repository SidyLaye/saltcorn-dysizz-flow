/* Garde-fous multi-tenant (src/garde.js) : variables d'environnement et expressions. */
const assert = require("assert");
const Module = require("module");
const vm = require("vm");

/* Saltcorn simulé : un tenant courant qu'on change, et un bac à sable pour eval_expression */
let tenant = "public";
const appels = [];
const fakeDb = { getTenantSchema: () => tenant, connectObj: { default_schema: "public" } };
const fakeExpr = {
  eval_expression: (code, row, user, where) => {
    appels.push({ code, where });
    /* nouveau contexte sans process ni require, comme le bac à sable de Saltcorn */
    return vm.runInNewContext(`"use strict"; ${code}`, Object.create(null));
  },
};
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/db") return fakeDb;
  if (req === "@saltcorn/data/models/expression") return fakeExpr;
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, ...rest);
};

const garde = require("../src/garde");
const { BLOCKS } = require("../src/blocks");
const B = (n) => BLOCKS.find((b) => b.name === n);

(async () => {
  process.env.PGPASSWORD = "base";
  process.env.SALTCORN_SESSION_SECRET = "sessions";
  process.env.DZF_CLE_COFFRE = "coffre";
  process.env.REDIS_URL = "redis://:x@r:6379";
  process.env.DZ_TEST_API = "cle-api";
  process.env.DZ_PARTAGEE = "commune";
  process.env.DZF_ENV_PARTAGEES = "DZ_PARTAGEE, AUTRE";

  /* tenant racine : tout sauf les secrets du serveur */
  tenant = "public";
  assert.strictEqual(garde.estRacine(), true);
  for (const n of ["PGPASSWORD", "pgpassword", "SALTCORN_SESSION_SECRET", "DZF_CLE_COFFRE", "REDIS_URL", "DZF_ENV_PARTAGEES"]) {
    assert.strictEqual(garde.lireEnv(n), undefined, `${n} ne doit jamais sortir`);
    assert.match(garde.refusEnv(n), /jamais/);
  }
  assert.strictEqual(garde.lireEnv("DZ_TEST_API"), "cle-api", "racine : variable ordinaire lisible");
  assert.strictEqual(garde.lireEnv("../etc"), undefined, "nom invalide refusé");

  /* autre tenant : seulement les variables partagées */
  tenant = "client1";
  assert.strictEqual(garde.estRacine(), false);
  assert.strictEqual(garde.lireEnv("DZ_TEST_API"), undefined, "tenant : variable non partagée refusée");
  assert.match(garde.refusEnv("DZ_TEST_API"), /DZF_ENV_PARTAGEES/);
  assert.strictEqual(garde.lireEnv("DZ_PARTAGEE"), "commune", "tenant : variable partagée lisible");
  assert.strictEqual(garde.lireEnv("PGPASSWORD"), undefined, "tenant : secret du serveur refusé même s'il est listé");
  process.env.DZF_ENV_PARTAGEES = "PGPASSWORD";
  assert.strictEqual(garde.lireEnv("PGPASSWORD"), undefined, "lister un secret du serveur ne l'ouvre pas");
  process.env.DZF_ENV_PARTAGEES = "DZ_PARTAGEE";

  /* ce que reçoivent les blocs (ex. « Appeler une API ») suit la même règle */
  const api = require("../src/engine").makeApi({});
  assert.strictEqual(api.env("PGPASSWORD"), undefined, "api.env : secret du serveur refusé");
  assert.strictEqual(api.env("DZ_PARTAGEE"), "commune");
  assert.strictEqual(await api.secret("DZ_PARTAGEE"), "commune", "api.secret : variable partagée");

  /* expressions : directes à la racine, bac à sable ailleurs */
  const items = [{ p: 3 }, { p: 10 }, { p: 7 }];
  tenant = "public";
  appels.length = 0;
  assert.strictEqual((await B("dzf_liste_filtrer").run({ liste: items, expression: "item.p > 5" }, {})).length, 2);
  assert.strictEqual(appels.length, 0, "racine : pas de bac à sable");

  tenant = "client1";
  assert.strictEqual((await B("dzf_liste_filtrer").run({ liste: items, expression: "item.p > 5" }, {})).length, 2, "tenant : même résultat");
  assert.strictEqual(appels.length, 1, "tenant : compilée une seule fois dans le bac à sable, pas une fois par élément");
  const fuite = await B("dzf_liste_filtrer").run({ liste: items, expression: "typeof process !== 'undefined'" }, {});
  assert.strictEqual(fuite.length, 0, "tenant : process inaccessible");
  assert.strictEqual(await B("dzf_verifier").run({ condition: "ctx.n > 1" }, { n: 2 }), true, "condition dans le bac à sable");
  assert.strictEqual(await B("dzf_verifier").run({ condition: "typeof require === 'function'" }, {}), false, "tenant : require inaccessible");
  await assert.rejects(() => B("dzf_verifier").run({ condition: "1 +" }, {}), /condition invalide/, "erreur de syntaxe lisible");

  /* l'expression du filtre n'est plus interpolée : une valeur reçue ne devient jamais du code */
  const p = B("dzf_liste_filtrer").params.find((x) => x.name === "expression");
  assert.strictEqual(p.raw, true);

  const plugin = require("../index.js");
  const exported = plugin.dysizz_flow_api;
  assert.strictEqual(await exported.secretEgal("PGPASSWORD", "base"), false);
  await assert.rejects(exported.iaDepuisCoffre("openai", "modele-test", "PGPASSWORD").lire({}, "Test"), /absente/);
  console.log("garde multi-tenant ok (IA et comparaison de secrets incluses)");
})().catch((e) => { console.error(e); process.exit(1); });
