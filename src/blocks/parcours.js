/* Parcours : exécute un schéma dessiné avec le widget « parcours » de dysizz-ui
   (étapes reliées par des flèches), typiquement enregistré dans une table et
   modifiable par les utilisateurs d'un client.

   Types d'étapes compris :
     debut, fin, etape (étape manuelle, rien à exécuter), note
     definir     reglages.valeurs : { clé: valeur avec {{variables}} } ajoutées aux données
     condition   reglages.expression (JavaScript, toujours dans le bac à sable) ;
                 flèches « oui » / « non » (ou vrai/faux)
     attente     s'arrête et renvoie statut « en_attente » : on reprend plus tard
                 avec « Reprendre à l'étape » = une des étapes suivantes
     bloc        un bloc dysizz-flow (n.bloc), réglages dans n.reglages ;
                 SEULEMENT s'il est dans la liste « Blocs autorisés »
     workflow    un workflow Saltcorn (reglages.workflow) ; seulement s'il est autorisé

   Sécurité : le schéma vient des données, pas de l'admin. Rien n'est exécuté
   qui n'ait été autorisé ici par l'admin, et les conditions passent toujours
   par le bac à sable des formules Saltcorn. */
"use strict";
const { lireParcours, suivants } = (() => {
  const W = /^\s*\{\{\s*([\w.$-]+)\s*\}\}\s*$/;
  const lire = (v, ctx) => {
    const { getPath, parseJSON } = require("../engine");
    let d = v;
    if (typeof d === "string" && W.test(d)) d = getPath(ctx, W.exec(d)[1]);
    if (typeof d === "string") d = parseJSON(d, "Parcours");
    if (!d || !Array.isArray(d.noeuds)) throw Object.assign(new Error("parcours illisible : il faut { noeuds: [...], liens: [...] }"), { permanent: true });
    if (d.noeuds.length > 500) throw Object.assign(new Error("parcours trop grand (500 étapes au plus)"), { permanent: true });
    return { noeuds: d.noeuds, liens: Array.isArray(d.liens) ? d.liens : [] };
  };
  const OUI = /^(oui|vrai|true|yes|1)$/i, NON = /^(non|faux|false|no|0)$/i;
  const next = (doc, n, branche) => doc.liens.filter((l) => l.de === n.id && (branche === undefined || (branche ? OUI.test(l.si || "") : NON.test(l.si || "")))).map((l) => l.vers);
  return { lireParcours: lire, suivants: next };
})();
const liste = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
const perm = (m) => Object.assign(new Error(m), { permanent: true });
const court = (v) => { try { const s = typeof v === "string" ? v : JSON.stringify(v); return s === undefined ? "" : s.length > 300 ? s.slice(0, 300) + "…" : s; } catch (e) { return String(v); } };

module.exports = [
  {
    name: "dzf_parcours", label: "Exécuter un parcours", category: "Contrôle", icon: "fas fa-project-diagram", output: "parcours", timeout: 300,
    description: "Déroule un parcours dessiné avec le widget « parcours » (étapes, conditions, validations, blocs). Pour les outils de workflow que tu construis pour un client : il dessine, ce bloc exécute. Mode simulation : rien n'est exécuté, tu vois le chemin.",
    params: [
      { name: "parcours", label: "Parcours", type: "json", raw: true, required: true, help: "Ex. {{row.schema}} : le champ où le widget enregistre le parcours" },
      { name: "donnees", label: "Données de départ (JSON)", type: "json", help: "Ajoutées au contexte, lisibles dans les conditions (ctx.montant…)" },
      { name: "depart", label: "Reprendre à l'étape", help: "Identifiant d'étape. Vide : l'étape « Début »" },
      { name: "blocs_autorises", label: "Blocs autorisés", help: "Noms de blocs dysizz-flow séparés par des virgules (ex. dzf_email, dzf_table_ajouter). Tout autre bloc est refusé." },
      { name: "workflows_autorises", label: "Workflows autorisés", help: "Noms de workflows Saltcorn qu'une étape peut lancer, séparés par des virgules" },
      { name: "simulation", label: "Simulation (n'exécute rien)", type: "bool", help: "Suit le chemin, évalue les conditions, montre ce qui serait lancé" },
      { name: "max_etapes", label: "Étapes au plus", type: "int", default: 200, help: "Protège contre les boucles sans fin" },
    ],
    run: async (p, ctx, api) => {
      const { resolveParams, withTimeout, sanitize, deep, parseJSON } = require("../engine");
      const { BLOCKS } = require("./index");
      const garde = require("../garde");
      const doc = lireParcours(p.parcours, ctx);
      const blocsOk = new Set(liste(p.blocs_autorises)), wfOk = new Set(liste(p.workflows_autorises));
      const par = new Map(doc.noeuds.map((n) => [n.id, n]));
      let data = { ...ctx, ...(typeof p.donnees === "object" && p.donnees ? p.donnees : {}) };
      const trace = [];
      const debut = p.depart ? par.get(String(p.depart)) : doc.noeuds.find((n) => n.type === "debut");
      if (!debut) throw perm(p.depart ? `étape « ${p.depart} » introuvable dans le parcours` : "le parcours n'a pas d'étape « Début »");
      const file = [debut.id];
      const max = Math.max(1, Math.min(5000, +p.max_etapes || 200));
      let n = 0;
      const fin = (statut, extra = {}) => ({ statut, etapes: n, simulation: !!p.simulation, trace, ...extra, donnees: sanitize(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "user"))) });
      while (file.length) {
        const noeud = par.get(file.shift());
        if (!noeud) continue;
        if (++n > max) return fin("erreur", { erreur: `plus de ${max} étapes : boucle probable`, noeud: noeud.id });
        const t0 = Date.now();
        const t = { noeud: noeud.id, type: noeud.type, titre: noeud.titre || noeud.type };
        const r = noeud.reglages || {};
        let aSuivre;
        try {
          switch (noeud.type) {
            case "condition": {
              if (!r.expression) throw perm("condition vide");
              const vrai = !!garde.compilerBacASable(r.expression, ["ctx"])(data);
              t.resultat = vrai ? "oui" : "non";
              aSuivre = suivants(doc, noeud, vrai);
              break;
            }
            case "definir": {
              const v = typeof r.valeurs === "string" ? parseJSON(r.valeurs, "Valeurs") : r.valeurs || {};
              data = { ...data, ...deep(v, data) };
              break;
            }
            case "attente":
              trace.push({ ...t, ok: true, ms: 0, resultat: "en attente" });
              return fin("en_attente", { noeud: noeud.id, suivants: suivants(doc, noeud) });
            case "bloc": {
              const nom = noeud.bloc || r.bloc;
              if (!blocsOk.has(nom)) throw perm(`bloc « ${nom} » non autorisé pour ce parcours`);
              const b = BLOCKS.find((x) => x.name === nom);
              if (!b) throw perm(`bloc « ${nom} » introuvable`);
              if (b.name === "dzf_parcours") throw perm("un parcours ne peut pas en lancer un autre");
              const params = resolveParams(b, r, data);
              const res = p.simulation ? { simulation: true, bloc: nom, reglages: params } : await withTimeout(Promise.resolve(b.run(params, data, api)), +r.delai_max || b.timeout || 30, b.label);
              data = { ...data, [r.sortie || b.output || noeud.id]: res };
              t.resultat = court(res);
              break;
            }
            case "workflow": {
              const nom = r.workflow;
              if (!wfOk.has(nom)) throw perm(`workflow « ${nom} » non autorisé pour ce parcours`);
              const Trigger = require("@saltcorn/data/models/trigger");
              const wf = Trigger.findOne({ name: nom });
              if (!wf) throw perm(`workflow « ${nom} » introuvable`);
              if (p.simulation) { t.resultat = `simulation : ${nom}`; break; }
              const out = await wf.runWithoutRow({ row: data, user: api.user, req: api.req });
              if (out && typeof out === "object") data = { ...data, ...out };
              t.resultat = court(out);
              break;
            }
            case "fin":
              aSuivre = [];
              break;
            default: /* debut, etape, note, ou type inconnu : rien à exécuter */
              break;
          }
        } catch (e) {
          trace.push({ ...t, ok: false, ms: Date.now() - t0, erreur: e.message });
          return fin("erreur", { erreur: e.message, noeud: noeud.id });
        }
        trace.push({ ...t, ok: true, ms: Date.now() - t0 });
        if (trace.length > 1000) trace.splice(0, trace.length - 1000);
        file.push(...(aSuivre || suivants(doc, noeud)));
      }
      return fin("termine");
    },
  },
];
