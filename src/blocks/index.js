/* La bibliothèque de blocs intégrés, par catégorie. Ajouter un bloc : l'écrire
   dans le fichier de sa catégorie (voir docs/CREER-UN-BLOC.md). Un autre plugin
   peut aussi en apporter (export `dysizz_flow_blocks`, voir src/registry.js). */
"use strict";
const BLOCKS = [
  ...require("./donnees"),
  ...require("./transformer"),
  ...require("./transformer_plus"),
  ...require("./reseau"),
  ...require("./messagerie"),
  ...require("./ia"),
  ...require("./services"),
  ...require("./emplois"),
  ...require("./securite"),
  ...require("./surveillance"),
  ...require("./surveillance_plus"),
  ...require("./observabilite"),
  ...require("./taches"),
  ...require("./extras"),
  ...require("./controle"),
];
const CATEGORIES = ["Données", "Transformer", "Réseau", "Messagerie", "IA", "Services", "Sécurité", "Surveillance", "Logs & métriques", "Tâches & planification", "Contrôle", "Extensions", "Mes blocs"];

/* garde-fou : pas deux blocs du même nom */
const seen = new Set();
for (const b of BLOCKS) {
  if (seen.has(b.name)) throw new Error(`dysizz-flow : bloc en double ${b.name}`);
  seen.add(b.name);
}
module.exports = { BLOCKS, CATEGORIES };
