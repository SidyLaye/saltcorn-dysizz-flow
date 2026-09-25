/* Mode ombre : les lectures passent, les écritures sont seulement notées. */
"use strict";
const ECRITURES = ["creerContact", "majContact", "lierBien", "ajouterConsentement"];
const ombre = (crm) => {
  const notees = [];
  const o = { ...crm, nom: crm.nom + " (ombre)", ombre: true, notees };
  for (const k of ECRITURES) o[k] = async (...args) => { notees.push({ op: k, args: args.map((a) => (a && a.preuves ? { ...a, preuves: a.preuves.map((p) => p.nom) } : a)) }); return { id: k === "creerContact" ? "ombre-" + notees.length : args[0], ombre: true }; };
  return o;
};
module.exports = { ombre, ECRITURES };
