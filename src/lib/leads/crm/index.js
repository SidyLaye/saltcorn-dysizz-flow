/* Choix de l'adaptateur CRM d'un client. Tous exposent la même interface :
   bienParId, biensParReference, biensParCriteres, contactsParEmail, contactsParTelephone,
   creerContact, majContact, lierBien, ajouterConsentement, tester. */
"use strict";
const ADAPTATEURS = { immofacile: require("./immofacile"), salesforce: require("./salesforce"), memoire: require("./memoire") };
const { ombre } = require("./ombre");
const creerCrm = (type, cfg = {}, { mode = "ombre" } = {}) => {
  const A = ADAPTATEURS[type];
  if (!A) throw Object.assign(new Error(`CRM inconnu : ${type} (disponibles : ${Object.keys(ADAPTATEURS).join(", ")})`), { permanent: true });
  const crm = A.creer({ ...cfg, lectureSeule: mode !== "reel" });
  return mode === "reel" ? crm : ombre(crm);
};
module.exports = { creerCrm, ADAPTATEURS };
