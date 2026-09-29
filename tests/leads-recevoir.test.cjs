/* « Leads : recevoir un mail rangé par un autre système » : recopie dans la table des mails reçus, une seule fois,
   champs renommés, puis événement DzfMailRecu sur le canal de l'écouteur. Saltcorn simulé, données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
const tab = (lignes) => ({ name: "t", getFields: () => [], getRow: async (w) => lignes.find((l) => Object.entries(w).every(([k, v]) => l[k] === v)) || null,
  getRows: async (w) => lignes.filter((l) => Object.entries(w).every(([k, v]) => l[k] === v)), insertRow: async (r) => { const id = lignes.length + 100; lignes.push({ ...r, id }); return id; } });
const SRC = [{ id: 1, expediteur: "Portail <x@portail-exemple.fr>", destinataire: "rodez@agence-exemple.fr", sujet: "Nouveau contact", corps_texte: "Bonjour", date_envoi: new Date("2026-09-20T08:00:00Z") }];
const MAILS = [], EVTS = [];
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/models/table") return { findOne: ({ name }) => (name === "boite" ? tab(SRC) : name === "ld_mails" ? tab(MAILS) : null) };
  if (req === "@saltcorn/data/models/trigger") return { emitEvent: async (...a) => EVTS.push(a) };
  if (req === "../ecouteurs" || /[\\/]ecouteurs$/.test(req)) return { tableDest: async () => tab(MAILS) };
  if (req.startsWith("@saltcorn/")) return class {};
  return orig.call(this, req, ...rest);
};
const B = require("../src/blocks/leads_solution").find((b) => b.name === "dzf_leads_recevoir");
(async () => {
  const p = { prefixe: "ld_", table: "boite", id: "1", champs: '{"objet":"sujet"}', ecouteur: "leads" };
  const a = await B.run(p), b = await B.run(p);
  assert(a.nouveau && !b.nouveau && a.id === b.id, "recopié une seule fois");
  assert.strictEqual(MAILS.length, 1); assert.strictEqual(MAILS[0].objet, "Nouveau contact", "champ renommé"); assert.strictEqual(MAILS[0].message_id, "boite:1");
  assert.strictEqual(EVTS.length, 1); assert.deepStrictEqual([EVTS[0][0], EVTS[0][1], EVTS[0][3].id], ["DzfMailRecu", "leads", a.id], "le traitement est lancé une fois");
  await assert.rejects(B.run({ ...p, id: "9" }), /introuvable/);
  console.log("recevoir OK : recopié une fois, champs renommés, traitement lancé");
})().catch((e) => { console.error(e); process.exit(1); });
