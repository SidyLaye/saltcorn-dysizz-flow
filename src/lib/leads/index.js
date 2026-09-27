/* Moteur « leads immobiliers » exposé aux autres plugins (dysizz_flow_api.leads). */
"use strict";
module.exports = {
  ...require("./extraire"),
  ...require("./rapprochement"),
  ...require("./contact"),
  ...require("./routage"),
  ...require("./traiter"),
  ...require("./crm"),
  conversation: require("./conversation"),
  dossiers: require("./dossiers"),
  ia: require("./ia"),
  apprentissage: require("./apprentissage"),
  ...require("./lecture"),
  PORTAILS: require("./portails").PORTAILS,
  valeurs: require("./valeurs"),
  texte: require("./texte"),
};
