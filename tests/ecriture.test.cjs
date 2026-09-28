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
  console.log("contrôle d'écriture OK : propriétaire vérifié, valeur recopiée, admin autorisé");
})().catch((e) => { console.error(e); process.exit(1); });
