/* Les tuiles de dysizz-flow sur l'accueil Dysizz (/dysizz, fourni par dysizz-ui). */
"use strict";
const admin = (req) => !!(req && req.user && req.user.role_id === 1);
const liveWf = async () => {
  const WR = require("@saltcorn/data/models/workflow_run");
  const runs = await WR.find({ started_at: { gt: new Date(Date.now() - 864e5) } }, { limit: 5000 }).catch(() => []);
  const e = runs.filter((r) => r.status === "Error").length;
  return e ? { n: e, text: `${e} en erreur (24 h)` } : { text: `${runs.length} exécution(s) sur 24 h` };
};
const liveWfCount = async () => {
  const n = require("@saltcorn/data/models/trigger").find({ action: "Workflow" }).length;
  return { n, text: `${n} workflow${n > 1 ? "s" : ""}` };
};
const dysizz_hub = (req) => (admin(req) ? [
  { group: "Workflows", label: "Mes workflows", sub: "les voir en schéma, les modifier sans code", url: "/dysizz-flow/workflows", icon: "fas fa-project-diagram", color: "#e3a21a", size: "w", live: liveWfCount },
  { group: "Workflows", label: "Nouveau", url: "/dysizz-flow/editeur/nouveau", icon: "fas fa-plus", color: "#00a300", size: "s" },
  { group: "Workflows", label: "Catalogue", sub: "modèles prêts à l'emploi", url: "/dysizz-flow/modeles", icon: "fas fa-magic", color: "#603cba", size: "m" },
  { group: "Workflows", label: "Blocs", sub: "les 100+ blocs", url: "/dysizz-flow", icon: "fas fa-cubes", color: "#2d89ef", size: "m" },
  { group: "Workflows", label: "Supervision", url: "/dysizz-flow/supervision", icon: "fas fa-tachometer-alt", color: "#b91d47", size: "s", live: liveWf },
  { group: "Workflows", label: "Points d'API", url: "/dysizz-flow/api", icon: "fas fa-plug", color: "#00aba9", size: "s" },
  { group: "Workflows", label: "Coffre", url: "/dysizz-flow/coffre", icon: "fas fa-lock", color: "#3a4a5c", size: "s" },
  { group: "Workflows", label: "Atelier", url: "/dysizz-flow/atelier", icon: "fas fa-tools", color: "#7e3878", size: "s" },
  { group: "Workflows", label: "Journal", url: "/dysizz-flow/journal", icon: "fas fa-clipboard-list", color: "#8a5a2b", size: "s" },
] : []);
module.exports = { dysizz_hub };
