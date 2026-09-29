/* Solution « Leads immobiliers » de dysizz-flow : petits utilitaires partagés. */
"use strict";
/* l'API de dysizz-flow elle-même (CRM, IA, verrous, moteur leads, écouteurs) */
const flowApi = () => require("../../../api");
const dateFr = (d, heure = true) => { if (!d) return ""; const x = new Date(d); return isNaN(x) ? "" : x.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", ...(heure ? { hour: "2-digit", minute: "2-digit" } : {}) }); };
const jour = (d) => new Date(d).toISOString().slice(0, 10);
module.exports = { flowApi, dateFr, jour };
