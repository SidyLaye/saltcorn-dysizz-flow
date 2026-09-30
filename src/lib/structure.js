/* Structure des tables : créer une table ou la compléter, sans jamais rien supprimer ni modifier.
   Sert au bloc « Table : créer ou compléter » et aux solutions de dysizz-flow (Leads…).

   definition = {
     nom, description, lecture: 40, ecriture: 40,          // rôles Saltcorn (1 admin … 100 public)
     champs: [{ nom, type: "String" | "Integer" | "Float" | "Bool" | "Date" | "JSON",
                libelle, obligatoire, unique, lien: "autre_table", options: "a,b,c" }],
     index: ["champ", …]                                     // Postgres seulement
   } */
"use strict";
const TYPES = ["String", "Integer", "Float", "Bool", "Date", "JSON"];
const NOM = /^[a-z][a-z0-9_]{0,62}$/;
const perm = (m) => Object.assign(new Error(m), { permanent: true });

/* forme courte acceptée par les solutions : ["nom", "Type", { required, is_unique… }] */
const versChamp = (c) => (Array.isArray(c) ? { nom: c[0], type: c[1], ...(c[2] || {}) } : c);

const assurer = async (def) => {
  const Table = require("@saltcorn/data/models/table"), Field = require("@saltcorn/data/models/field");
  const db = require("@saltcorn/data/db");
  const nom = String(def.nom || "").trim();
  if (!NOM.test(nom)) throw perm(`nom de table invalide « ${nom} » (minuscules, chiffres, _)`);
  const champs = (def.champs || []).map(versChamp);
  for (const c of champs) {
    if (!NOM.test(String(c.nom || ""))) throw perm(`nom de champ invalide « ${c.nom} »`);
    if (!c.lien && !TYPES.includes(c.type)) throw perm(`type inconnu pour « ${c.nom} » : ${c.type} (${TYPES.join(", ")}, ou un lien)`);
  }
  const out = { table: nom, creee: false, champs_ajoutes: [] };
  let t = await require("./rafraichir").trouverTable(nom);
  if (!t) {
    const note = await require("./rafraichir").libererNom(nom);
    if (note) out.note = note;
    t = await Table.create(nom, { min_role_read: +def.lecture || 1, min_role_write: +def.ecriture || 1, description: def.description || "" });
    out.creee = true;
  }
  const have = new Set(t.getFields().map((f) => f.name));
  for (const c of champs) {
    if (have.has(c.nom)) continue;
    const base = { table: t, name: c.nom, label: c.libelle || c.label || c.nom, required: out.creee ? !!(c.obligatoire || c.required) : false, is_unique: !!(c.unique || c.is_unique) };
    if (c.lien) await Field.create({ ...base, type: `Key to ${c.lien}`, reftable_name: c.lien, attributes: c.attributes || {} });
    else await Field.create({ ...base, type: c.type, attributes: { ...(c.options ? { options: c.options } : {}), ...(c.attributes || {}) } });
    out.champs_ajoutes.push(c.nom);
  }
  if (out.creee || out.champs_ajoutes.length) await require("./rafraichir").rafraichir();
  /* « if not exists » : une requête en erreur annulerait la transaction en cours */
  if (!db.isSQLite) for (const f of def.index || []) if (NOM.test(f)) await db.query(`create index if not exists "${nom}_${f}_idx" on "${db.getTenantSchema()}"."${nom}" ("${f}")`);
  return { ...out, t: Table.findOne({ name: nom }) };
};

module.exports = { assurer, TYPES };
