/* Moteur « leads immobiliers » exposé aux autres plugins (dysizz_flow_api.leads). */
"use strict";
module.exports = {
  ...require("./extraire"),
  ...require("./rapprochement"),
  ...require("./contact"),
  ...require("./routage"),
  ...require("./traiter"),
  ...require("./crm"),
  PORTAILS: require("./portails").PORTAILS,
  valeurs: require("./valeurs"),
  texte: require("./texte"),
};
