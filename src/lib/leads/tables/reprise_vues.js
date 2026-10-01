/* Recalcul des tables de lecture après modification des requêtes du workflow. */
"use strict";

const NOM = /^[a-z_][a-z0-9_]{0,62}$/i;
const etapesValides = (texte) => {
  const a = String(texte || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!a.length || a.length > 12 || a.some((s) => !NOM.test(s)) || new Set(a).size !== a.length)
    throw new Error("Liste d'étapes invalide");
  return a;
};
const lire = (v) => typeof v === "string" ? JSON.parse(v) : v;

const rafraichirVues = async ({ workflow, etapes, suivi = {}, api }) => {
  const nom = String(workflow || "").trim();
  if (!NOM.test(nom)) throw new Error("Nom du workflow invalide");
  const noms = etapesValides(etapes);
  const db = require("@saltcorn/data/db");
  const rows = (await db.query(
    "select s.name,s.configuration from _sc_workflow_steps s " +
    "join _sc_triggers t on t.id=s.trigger_id where t.name=$1 and s.name=any($2::text[])",
    [nom, noms])).rows;
  if (rows.length !== noms.length) throw new Error("Étapes de lecture manquantes ou multiples");
  const parNom = Object.fromEntries(rows.map((r) => [r.name, lire(r.configuration)]));
  for (const n of noms) {
    const c = parNom[n];
    if (!c || c.table !== n || c.cle == null || !String(c.requete || "").trim())
      throw new Error(`Configuration de ${n} incomplète ou table inattendue`);
  }
  const bloc = require("../../../blocks/extras").find((b) => b.name === "dzf_table_lecture");
  if (!bloc) throw new Error("Bloc de lecture indisponible");
  const rapport = { workflow: nom, etapes: [], terminees: 0, erreur: null, emails_envoyes: 0 };
  suivi.total = noms.length;
  for (const n of noms) {
    suivi.etape = `recalcul ${n}`;
    const c = parNom[n];
    try {
      const resultat = await bloc.run({ table: c.table, cle: c.cle, requete: c.requete,
        cles: null, supprimer: true, delai_s: 300 }, {}, api);
      rapport.etapes.push({ nom: n, resultat });
      rapport.terminees++;
      suivi.fait++;
    } catch (e) {
      rapport.erreur = `${n} : ${String(e.message || e).slice(0, 300)}`;
      break; /* une vue dépendante ne doit pas être recalculée sur des données anciennes */
    }
  }
  return rapport;
};

module.exports = { etapesValides, rafraichirVues };
