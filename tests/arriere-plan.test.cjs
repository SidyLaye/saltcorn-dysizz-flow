/* Travaux longs en arrière-plan : réponse immédiate (pas de « Bad Gateway »), un seul à la fois,
   rapport d'erreur dans Fichiers si le travail échoue, attente possible si on le demande. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
const FICHIERS = [];
Module._load = function (req, ...rest) {
  if (req === "@saltcorn/data/models/file") return { from_contents: async (nom, type, contenu) => { FICHIERS.push({ nom, contenu }); } };
  if (req.startsWith("@saltcorn/")) return { getTenantSchema: () => "public" };
  return orig.call(this, req, ...rest);
};
const { enFond } = require("../src/lib/arriere_plan");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let fini = false;
  const t0 = Date.now();
  const r = await enFond({}, {}, "bloc_test", "rapport.json", async (suivi) => { suivi.etape = "mails"; suivi.total = 10; suivi.fait = 4; await pause(200); fini = true; return { ok: 1 }; });
  assert(r.lance && Date.now() - t0 < 100 && !fini, "réponse immédiate, travail en cours");
  await pause(20);
  const r2 = await enFond({}, {}, "bloc_test", "rapport.json", async () => ({}));
  assert(!r2.lance && r2.deja_en_cours && /mails : 4 \/ 10/.test(r2.resume), "un seul à la fois, et on voit où il en est : " + r2.resume);
  await pause(300); assert(fini, "le travail va au bout");
  await enFond({}, {}, "bloc_err", "x.json", async () => { throw new Error("jeton Immofacile HTTP 502"); });
  await pause(50);
  assert(FICHIERS.some((f) => f.nom === "x-erreur.json" && /502/.test(f.contenu)), "échec rangé dans Fichiers");
  /* un travail bloqué est arrêté au bout du délai, avec la dernière étape connue */
  await enFond({}, {}, "bloc_bloque", "z.json", async (suivi) => { suivi.etape = "lecture par l'IA"; await new Promise(() => {}); }, { dureeMax: 100 });
  await pause(200);
  assert(FICHIERS.some((f) => f.nom === "z-erreur.json" && /arrêté après/.test(f.contenu) && /lecture par l'IA/.test(f.contenu)), "travail bloqué arrêté : " + JSON.stringify(FICHIERS));
  const r3 = await enFond({}, {}, "bloc_bloque", "z.json", async () => ({}));
  assert(r3.lance, "après l'arrêt, on peut relancer");
  const { borne } = require("../src/lib/arriere_plan");
  await assert.rejects(borne(new Promise(() => {}), 50, "IA"), /IA : pas de réponse/);
  const direct = await enFond({ arriere_plan: false }, {}, "bloc_direct", "y.json", async () => ({ ok: 2 }));
  assert.strictEqual(direct.ok, 2, "sans arrière-plan : on attend le résultat");
  console.log("arrière-plan OK : réponse immédiate, un seul à la fois, erreur rangée dans Fichiers");
})().catch((e) => { console.error(e); process.exit(1); });
