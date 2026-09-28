/* Bloc « Table : contrôler une écriture » (événement Validate). Saltcorn simulé. */
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/db") return { getTenantSchema: () => "public", connectObj: { default_schema: "public" } };
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, ...rest);
};
const { BLOCKS, } = require("../src/blocks");
const { toAction } = require("../src/engine");
const bloc = BLOCKS.find((b) => b.name === "dzf_ecriture_controler");
const TICKETS = [{ id: 1, demandeur: 10 }, { id: 2, demandeur: 20 }];
const api = { Table: { findOne: ({ name }) => (name === "ticket" ? { getRow: async ({ id }) => TICKETS.find((t) => t.id === +id) || null } : null) } };
const conf = { lien: { champ: "ticket", table: "ticket" }, refuser_si: "user.role_id > 1 && (!liee || liee.demandeur !== user.id)", message: "Ce ticket n'est pas le vôtre", recopier: { demandeur: "demandeur" } };
const run = (row, user) => bloc.run({ ...conf }, { ...row, user }, api);
(async () => {
  assert.deepStrictEqual(await run({ ticket: 1, message: "ok", demandeur: 10 }, { id: 10, role_id: 80 }), { __saltcorn: true, set_fields: { demandeur: 10 } }, "le client écrit sur son ticket");
  assert.deepStrictEqual(await run({ ticket: 1, message: "intrus", demandeur: 20 }, { id: 20, role_id: 80 }), { __saltcorn: true, error: "Ce ticket n'est pas le vôtre" }, "un autre client est refusé");
  assert.deepStrictEqual(await run({ ticket: 99, message: "?" }, { id: 20, role_id: 80 }), { __saltcorn: true, error: "Ce ticket n'est pas le vôtre" }, "ticket absent : refusé");
  assert.deepStrictEqual(await run({ ticket: 2, message: "réponse" }, { id: 1, role_id: 1 }), { __saltcorn: true, set_fields: { demandeur: 20 } }, "l'admin répond : le message est rattaché au demandeur");
  /* branché comme action Saltcorn : le résultat va tel quel au « Validate » (error / set_fields) */
  const action = toAction(bloc);
  const r = await action.run({ configuration: { lien: JSON.stringify(conf.lien), refuser_si: conf.refuser_si, message: conf.message, recopier: JSON.stringify(conf.recopier) }, row: { ticket: 2, message: "x", demandeur: 10 }, user: { id: 10, role_id: 80 } }).catch((e) => ({ exception: e.message }));
  assert.ok(r.error === "Ce ticket n'est pas le vôtre" || /Table/.test(r.exception || ""), "action Saltcorn : refus transmis");
  /* modification en lot : seuls les champs remplis s'appliquent, seuls les critères posés filtrent */
  const EQ = [{ id: 1, agence: 12, temps: "plein", actif: true }, { id: 2, agence: 12, temps: "plein", actif: true }, { id: 3, agence: 7, temps: "plein", actif: true }];
  const eqT = { min_role_write: 40, min_role_read: 40, getRows: async (w) => EQ.filter((r) => Object.entries(w).every(([k, v]) => String(r[k]) === String(v))), updateRow: async (v, id) => Object.assign(EQ.find((r) => r.id === id), v) };
  const apiLot = { user: { id: 5, role_id: 40 }, Table: { findOne: ({ name }) => (name === "equipe" ? eqT : null) } };
  const mod = BLOCKS.find((b) => b.name === "dzf_table_modifier");
  const n = await mod.run({ table: "equipe", filtre: { agence: 12, groupe: "" }, valeurs: { temps: "mi_temps", jours: "", assistante: null }, ignorer_vides: true }, {}, apiLot);
  assert.strictEqual(n, 2, "deux personnes de l'agence 12");
  assert.deepStrictEqual(EQ.map((r) => r.temps), ["mi_temps", "mi_temps", "plein"], "seul le champ rempli change, seulement pour l'agence choisie");
  assert.ok(!("jours" in EQ[0]) && !("assistante" in EQ[0]), "les champs vides ne sont pas écrits");
  await assert.rejects(() => mod.run({ table: "equipe", filtre: { agence: "", groupe: null }, valeurs: { temps: "plein" }, ignorer_vides: true }, {}, apiLot), /filtre vide/, "aucun critère : refus de tout modifier");
  assert.strictEqual(await mod.run({ table: "equipe", filtre: { agence: 12 }, valeurs: { temps: "" }, ignorer_vides: true }, {}, apiLot), 0, "rien à changer : rien n'est écrit");
  /* écriture refusée par Saltcorn (champ protégé…) : il renvoie un message, le bloc doit échouer */
  const refuse = { ...eqT, updateRow: async () => "Not authorized" };
  const apiRefus = { ...apiLot, Table: { findOne: () => refuse } };
  await assert.rejects(() => mod.run({ table: "equipe", id: 1, valeurs: { temps: "plein" } }, {}, apiRefus), /modification refusée : Not authorized/, "refus transmis, pas de faux succès");
  console.log("contrôle d'écriture OK : propriétaire vérifié, valeur recopiée, admin autorisé, modification en lot, refus signalé");
})().catch((e) => { console.error(e); process.exit(1); });
