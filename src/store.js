/* Les tables du plugin, créées à la première utilisation (réservées aux admins) :
     dzf_blocs    : tes blocs perso (réglages + code)
     dzf_journal  : erreurs des blocs (et exécutions si tu le demandes)
     dzf_cache    : petit cache clé → valeur avec expiration (si pas de Redis)
     dzf_verrous  : « une seule exécution à la fois » entre serveurs
     dzf_versions : l'historique de tes blocs perso (retour arrière possible)
     + métriques, mesures, secrets chiffrés, planifications, points d'API, files.
   Évolution : un champ ajouté ici est créé tout seul dans les tables existantes. */
"use strict";

const DEFS = {
  blocs: {
    name: "dzf_blocs", fields: [
      ["nom", "String", { required: true, is_unique: true }], ["libelle", "String"], ["categorie", "String"], ["icone", "String"],
      ["description", "String"], ["params", "String"], ["code", "String"], ["sortie", "String"], ["actif", "Bool"], ["maj_le", "Date"], ["version", "Integer"],
    ],
  },
  journal: {
    name: "dzf_journal", fields: [["quand", "Date"], ["bloc", "String"], ["ok", "Bool"], ["duree_ms", "Integer"], ["message", "String"]],
  },
  cache: { name: "dzf_cache", fields: [["cle", "String", { required: true, is_unique: true }], ["valeur", "String"], ["expire", "Date"]] },
  metriques: { name: "dzf_metriques", fields: [["heure", "Date"], ["bloc", "String"], ["n", "Integer"], ["erreurs", "Integer"], ["ms_moyen", "Integer"], ["ms_max", "Integer"]] },
  mesures: { name: "dzf_mesures", fields: [["quand", "Date"], ["nom", "String"], ["valeur", "Float"], ["etiquettes", "String"]] },
  secrets: { name: "dzf_secrets", fields: [["nom", "String", { required: true, is_unique: true }], ["valeur", "String"], ["note", "String"], ["maj_le", "Date"]] },
  planifs: { name: "dzf_planifs", fields: [["workflow", "String", { required: true }], ["quand", "Date"], ["contexte", "String"], ["etat", "String"], ["cle", "String"], ["essais", "Integer"], ["message", "String"]] },
  points: { name: "dzf_points", fields: [["nom", "String", { required: true, is_unique: true }], ["workflow", "String"], ["methode", "String"], ["auth", "String"], ["secret", "String"], ["en_tete_signature", "String"], ["reponse", "String"], ["limite_minute", "Integer"], ["actif", "Bool"], ["note", "String"], ["executer_en", "String"]] },
  file: { name: "dzf_file", fields: [["file", "String", { required: true }], ["charge", "String"], ["etat", "String"], ["cree_le", "Date"], ["pris_le", "Date"], ["essais", "Integer"]] },
  versions: { name: "dzf_versions", fields: [["nom", "String", { required: true }], ["version", "Integer"], ["contenu", "String"], ["quand", "Date"], ["par", "String"]] },
  verrous: { name: "dzf_verrous", fields: [["nom", "String", { required: true, is_unique: true }], ["jusqu_a", "Date"], ["par", "String"]] },
};

let ready = null;
const ensureTables = async () => {
  const Table = require("@saltcorn/data/models/table");
  const Field = require("@saltcorn/data/models/field");
  const out = {};
  for (const [k, d] of Object.entries(DEFS)) {
    let t = Table.findOne({ name: d.name });
    if (!t) {
      t = await Table.create(d.name, { min_role_read: 1, min_role_write: 1, description: "dysizz-flow" });
      for (const [name, type, o] of d.fields) await Field.create({ table: t, name, label: name, type, ...(o || {}) });
      try { await require("@saltcorn/data/db/state").getState().refresh_tables(true); } catch (e) { /* rien */ }
      t = Table.findOne({ name: d.name });
    }
    /* migration douce : les champs ajoutés dans une version plus récente */
    const have = new Set(t.getFields().map((f) => f.name));
    const missing = d.fields.filter(([name]) => !have.has(name));
    for (const [name, type, o] of missing) await Field.create({ table: t, name, label: name, type, ...(o || {}), required: false, is_unique: false });
    if (missing.length) { try { await require("@saltcorn/data/db/state").getState().refresh_tables(true); } catch (e) { /* rien */ } t = Table.findOne({ name: d.name }); }
    out[k] = t;
  }
  return out;
};
/* appelée souvent : on ne vérifie qu'une fois par processus et par tenant */
const tables = async () => {
  const db = require("@saltcorn/data/db");
  const key = db.getTenantSchema();
  ready = ready || new Map();
  if (!ready.has(key)) ready.set(key, ensureTables().catch((e) => { ready.delete(key); throw e; }));
  return ready.get(key);
};

module.exports = { ensureTables: tables, DEFS };
