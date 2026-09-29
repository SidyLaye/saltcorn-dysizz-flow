/* Travaux longs (banc d'essai, contrôles) lancés depuis le bouton « Tester » ou un déclencheur :
   la requête HTTP rendrait la main trop tard (le proxy coupe au bout d'une minute ou deux, « Bad Gateway »).
   Ils tournent donc en arrière-plan :
   - réponse immédiate ; rapport rangé dans Fichiers à la fin ; en cas d'échec « …-erreur.json » qui dit pourquoi ;
   - un seul à la fois par tenant et par bloc ; un nouveau clic montre où il en est (étape, nombre traité) ;
   - durée bornée (2 h par défaut) : au-delà, arrêt et fichier d'erreur avec la dernière étape connue. */
"use strict";
const EN_COURS = globalThis[Symbol.for("dysizz-flow.arriere-plan")] || (globalThis[Symbol.for("dysizz-flow.arriere-plan")] = new Map());
const tenant = () => { try { return require("@saltcorn/data/db").getTenantSchema(); } catch (e) { return "public"; } };
const DUREE_MAX = 2 * 3600 * 1000;

const etatTexte = (s) => `${s.etape || "démarrage"}${s.total ? ` : ${s.fait || 0} / ${s.total}` : ""}`;

const enFond = async (p, ctx, bloc, fichier, travail, { dureeMax = DUREE_MAX } = {}) => {
  const suivi = { etape: "démarrage", fait: 0, total: 0, debut: Date.now() };
  if (p.arriere_plan === false || p.arriere_plan === "false") return travail(suivi);
  const cle = tenant() + ":" + bloc;
  const deja = EN_COURS.get(cle);
  if (deja && Date.now() - deja.debut < dureeMax)
    return { lance: false, deja_en_cours: true, depuis: deja.debut, etat: etatTexte(deja), resume: `Déjà en cours depuis ${Math.round((Date.now() - deja.debut) / 60000)} min (${etatTexte(deja)}) : le rapport arrivera dans Fichiers → ${fichier}` };
  EN_COURS.set(cle, suivi);
  /* Saltcorn range dans le contexte de la requête sa connexion à la base (transaction du bouton « Tester »),
     rendue dès la réponse. Le travail repart dans un contexte propre : même tenant, connexions communes. */
  let db = null, schema = null;
  try { db = require("@saltcorn/data/db"); schema = db.getTenantSchema(); } catch (e) { db = null; }
  const propre = (fn) => (db && db.runWithTenant && schema ? db.runWithTenant(schema, fn) : fn());
  let minuterie = null;
  const limite = new Promise((_, ko) => { minuterie = setTimeout(() => ko(new Error(`arrêté après ${Math.round(dureeMax / 60000)} min (dernière étape : ${etatTexte(suivi)})`)), dureeMax); });
  new Promise((ok) => setImmediate(ok))
    .then(() => Promise.race([propre(() => travail(suivi)), limite]))
    .catch((e) => propre(async () => {
      try {
        const File = require("@saltcorn/data/models/file");
        await File.from_contents(String(fichier).replace(/\.json$/, "") + "-erreur.json", "application/json",
          JSON.stringify({ erreur: String((e && e.message) || e).slice(0, 500), derniere_etape: etatTexte(suivi), le: new Date().toISOString(), apres_secondes: Math.round((Date.now() - suivi.debut) / 1000) }, null, 1), ctx && ctx.user && ctx.user.id, 1);
      } catch (x) { /* rien de plus à faire */ }
    }))
    .finally(() => { clearTimeout(minuterie); if (EN_COURS.get(cle) === suivi) EN_COURS.delete(cle); });
  return { lance: true, fichier, resume: `Lancé en arrière-plan : le rapport arrivera dans Fichiers → ${fichier} (quelques minutes). Recliquer montre où il en est. En cas de problème : ${String(fichier).replace(/\.json$/, "")}-erreur.json` };
};

/* Borne un appel (IA, CRM) : au-delà du délai, erreur plutôt qu'une attente sans fin. */
const borne = (promesse, ms, quoi) => { let t; return Promise.race([promesse, new Promise((_, ko) => { t = setTimeout(() => ko(new Error(`${quoi} : pas de réponse après ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t)); };

module.exports = { enFond, borne, EN_COURS };
