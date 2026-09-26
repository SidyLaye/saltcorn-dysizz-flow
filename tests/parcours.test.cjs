/* Bloc « Exécuter un parcours » : le schéma du widget parcours, déroulé pour de vrai. */
const assert = require("assert");
const Module = require("module");
const vm = require("vm");

const lances = [];
const mocks = {
  "@saltcorn/data/db": { getTenantSchema: () => "public", connectObj: { default_schema: "public" } },
  "@saltcorn/data/models/expression": { eval_expression: (code) => vm.runInNewContext(`"use strict"; ${code}`, Object.create(null)) },
  "@saltcorn/data/models/trigger": { findOne: ({ name }) => (name === "payer" ? { runWithoutRow: async ({ row }) => { lances.push(row.montant); return { paye: true }; } } : null) },
};
const orig = Module._load;
Module._load = function (req, ...rest) { if (mocks[req]) return mocks[req]; if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { BLOCKS } = require("../src/blocks");
const P = BLOCKS.find((b) => b.name === "dzf_parcours");

/* le parcours de la démo dysizz-ui : note de frais */
const NDF = { v: 1, noeuds: [
  { id: "d", type: "debut" },
  { id: "c", type: "condition", titre: "Plus de 500 € ?", reglages: { expression: "ctx.montant > 500" } },
  { id: "v", type: "attente", titre: "Accord du manager" },
  { id: "p", type: "workflow", titre: "Paiement", reglages: { workflow: "payer" } },
  { id: "f", type: "fin" }],
  liens: [{ de: "d", vers: "c" }, { de: "c", vers: "v", si: "oui" }, { de: "c", vers: "p", si: "non" }, { de: "v", vers: "p" }, { de: "p", vers: "f" }] };
const run = (p, ctx = {}) => P.run({ max_etapes: 200, workflows_autorises: "payer", ...p }, ctx, { user: { id: 1 } });

(async () => {
  assert.ok(P, "bloc enregistré");
  /* petite note : pas de validation, payée directement */
  let r = await run({ parcours: NDF, donnees: { montant: 120 } });
  assert.strictEqual(r.statut, "termine");
  assert.deepStrictEqual(r.trace.map((t) => t.noeud), ["d", "c", "p", "f"]);
  assert.strictEqual(r.trace[1].resultat, "non");
  assert.strictEqual(r.donnees.paye, true); assert.deepStrictEqual(lances, [120]);

  /* grosse note : s'arrête à la validation, puis reprend après l'accord */
  r = await run({ parcours: JSON.stringify(NDF), donnees: { montant: 800 } });
  assert.strictEqual(r.statut, "en_attente"); assert.strictEqual(r.noeud, "v"); assert.deepStrictEqual(r.suivants, ["p"]);
  assert.deepStrictEqual(lances, [120], "rien de payé avant l'accord");
  r = await run({ parcours: NDF, donnees: { montant: 800 }, depart: "p" });
  assert.strictEqual(r.statut, "termine"); assert.deepStrictEqual(lances, [120, 800]);

  /* le parcours peut venir d'une variable du contexte : {{row.schema}} */
  r = await run({ parcours: "{{row.schema}}", donnees: { montant: 1 } }, { row: { schema: JSON.stringify(NDF) } });
  assert.strictEqual(r.statut, "termine");

  /* simulation : le chemin est suivi, rien n'est lancé */
  lances.length = 0;
  r = await run({ parcours: NDF, donnees: { montant: 120 }, simulation: true });
  assert.strictEqual(r.statut, "termine"); assert.strictEqual(r.simulation, true); assert.deepStrictEqual(lances, []);

  /* sécurité : workflow ou bloc non autorisé = refusé, avec l'étape en cause */
  r = await run({ parcours: NDF, donnees: { montant: 120 }, workflows_autorises: "" });
  assert.strictEqual(r.statut, "erreur"); assert.strictEqual(r.noeud, "p"); assert.match(r.erreur, /non autorisé/);
  const avecBloc = { noeuds: [{ id: "d", type: "debut" }, { id: "b", type: "bloc", bloc: "dzf_texte", reglages: { modele: "Bonjour {{nom}}", sortie: "message" } }], liens: [{ de: "d", vers: "b" }] };
  r = await run({ parcours: avecBloc, donnees: { nom: "Awa" } });
  assert.strictEqual(r.statut, "erreur"); assert.match(r.erreur, /dzf_texte.*non autorisé/);
  r = await run({ parcours: avecBloc, donnees: { nom: "Awa" }, blocs_autorises: "dzf_texte" });
  assert.strictEqual(r.statut, "termine"); assert.strictEqual(r.donnees.message, "Bonjour Awa", "bloc autorisé exécuté, résultat rangé dans sa sortie");
  const recursif = { noeuds: [{ id: "d", type: "debut" }, { id: "b", type: "bloc", bloc: "dzf_parcours" }], liens: [{ de: "d", vers: "b" }] };
  r = await run({ parcours: recursif, blocs_autorises: "dzf_parcours" });
  assert.match(r.erreur, /ne peut pas en lancer un autre/);

  /* conditions écrites par des utilisateurs : toujours dans le bac à sable */
  const piege = { noeuds: [{ id: "d", type: "debut" }, { id: "c", type: "condition", reglages: { expression: "typeof process !== 'undefined' || typeof require !== 'undefined'" } }, { id: "o", type: "etape" }], liens: [{ de: "d", vers: "c" }, { de: "c", vers: "o", si: "oui" }] };
  r = await run({ parcours: piege });
  assert.strictEqual(r.trace[1].resultat, "non", "ni process ni require dans une condition, même à la racine");

  /* boucle sans fin : arrêtée net */
  const boucle = { noeuds: [{ id: "d", type: "debut" }, { id: "a", type: "etape" }], liens: [{ de: "d", vers: "a" }, { de: "a", vers: "a" }] };
  r = await run({ parcours: boucle, max_etapes: 20 });
  assert.strictEqual(r.statut, "erreur"); assert.match(r.erreur, /boucle/);

  /* schémas invalides : message clair */
  await assert.rejects(() => run({ parcours: { noeuds: [{ id: "x", type: "etape" }] } }), /Début/);
  await assert.rejects(() => run({ parcours: "pas du json" }), /JSON invalide/);
  await assert.rejects(() => run({ parcours: NDF, depart: "zzz" }), /introuvable/);

  /* les mots de passe ne sortent jamais dans les données renvoyées */
  r = await run({ parcours: NDF, donnees: { montant: 1, password: "x" } });
  assert.ok(!("password" in r.donnees));
  console.log("parcours ok");
})().catch((e) => { console.error(e); process.exit(1); });
