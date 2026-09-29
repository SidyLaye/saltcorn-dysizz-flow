/* Travaux longs (banc d'essai, contrôles) lancés depuis le bouton « Tester » ou un déclencheur :
   la requête HTTP rendrait la main trop tard (le proxy coupe au bout d'une minute ou deux, « Bad Gateway »).
   Ils tournent donc en arrière-plan : réponse immédiate, rapport rangé dans Fichiers à la fin,
   et en cas d'échec un fichier « …-erreur.json » qui dit pourquoi. Un seul à la fois par tenant et par bloc. */
"use strict";
const EN_COURS = globalThis[Symbol.for("dysizz-flow.arriere-plan")] || (globalThis[Symbol.for("dysizz-flow.arriere-plan")] = new Map());
const tenant = () => { try { return require("@saltcorn/data/db").getTenantSchema(); } catch (e) { return "public"; } };

const enFond = async (p, ctx, bloc, fichier, travail) => {
  if (p.arriere_plan === false || p.arriere_plan === "false") return travail();
  const cle = tenant() + ":" + bloc;
  const deja = EN_COURS.get(cle);
  if (deja) return { lance: false, deja_en_cours: true, depuis: deja, resume: `Déjà en cours depuis ${Math.round((Date.now() - deja) / 60000)} min : le rapport arrivera dans Fichiers → ${fichier}` };
  EN_COURS.set(cle, Date.now());
  const t0 = Date.now();
  travail()
    .catch(async (e) => {
      try {
        const File = require("@saltcorn/data/models/file");
        await File.from_contents(String(fichier).replace(/\.json$/, "") + "-erreur.json", "application/json",
          JSON.stringify({ erreur: String((e && e.message) || e).slice(0, 500), le: new Date().toISOString(), apres_secondes: Math.round((Date.now() - t0) / 1000) }, null, 1), ctx && ctx.user && ctx.user.id, 1);
      } catch (x) { /* rien de plus à faire */ }
    })
    .finally(() => EN_COURS.delete(cle));
  return { lance: true, fichier, resume: `Lancé en arrière-plan : le rapport arrivera dans Fichiers → ${fichier} (quelques minutes). En cas de problème : ${String(fichier).replace(/\.json$/, "")}-erreur.json` };
};

module.exports = { enFond, EN_COURS };
