/* La bibliothèque de blocs intégrés, par catégorie. Ajouter un bloc : l'écrire
   dans le fichier de sa catégorie (voir docs/CREER-UN-BLOC.md). */
"use strict";
const BLOCKS = [
  ...require("./donnees"),
  ...require("./transformer"),
  ...require("./reseau"),
  ...require("./messagerie"),
  ...require("./ia"),
  ...require("./services"),
  ...require("./controle"),
];
const CATEGORIES = ["Données", "Transformer", "Réseau", "Messagerie", "IA", "Services", "Contrôle", "Mes blocs"];
module.exports = { BLOCKS, CATEGORIES };
