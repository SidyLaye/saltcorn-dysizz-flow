/* Règles d'envoi lues dans les tables de l'équipe (Saltcorn), au format du moteur lib/leads/routage.

   Tables par défaut (noms réglables) :
   - equipe      : nom, email, role (negociateur | assistante | siege | autre), actif, assistante (→ equipe),
                   temps (plein | mi_temps), jours ("1,2,4" ; 1 = lundi), remplacant_hors_jours (→ equipe),
                   remplacant_inactif (→ equipe : qui reprend quand la personne est partie)
   - absence     : personne (→ equipe), debut, fin (vide = sans fin : départ, longue durée), remplacant (→ equipe)
                   ou remplacant_adresse (une adresse e-mail libre), motif, actif
   - regle_envoi : nom, actif, negociateur (→ equipe), ou negociateurs ("3,7,9"), ou groupe (même valeur que
                   equipe.groupe), ou agence (même valeur que equipe.agence), ou rien de tout ça (= tous),
                   couper_negociateur, assistante (garder | couper | remplacer, ou « reçoit », « ne reçoit pas »,
                   « remplacé(e) »), assistante_remplacante (→ equipe),
                   adresses_libres ("a@x, b@y")
   - copies      : email, portee ("tous" = en copie de chaque lead), actif

   Une colonne absente est ignorée : une table plus simple fonctionne aussi. */
"use strict";

const NOMS = { equipe: "equipe", absence: "absence", regle: "regle_envoi", copies: "destinataire_custom" };

/* date → « AAAA-MM-JJ » dans le fuseau voulu */
const jourDe = (d, fuseau) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) : null);
/* assistant(e) dans une règle : valeurs lisibles du formulaire ou valeurs du moteur */
const modeAssistante = (v) => {
  const x = String(v || "").toLowerCase();
  if (/^(couper|ne re[cç]oit pas|non)/.test(x)) return "couper";
  if (/^(remplac)/.test(x)) return "remplacer";
  return "garder";
};
const ids = (v) => String(v ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x));
const ref = (id) => (id ? { personne: id } : null);

const lireRoutage = async (noms = {}, fuseau = "Europe/Paris") => {
  const Table = require("@saltcorn/data/models/table");
  const n = { ...NOMS, ...(noms || {}) };
  const lire = async (nom, where = {}) => {
    const t = Table.findOne({ name: nom });
    if (!t) return [];
    const champs = new Set(t.getFields().map((f) => f.name));
    const w = Object.fromEntries(Object.entries(where).filter(([k]) => champs.has(k)));
    return t.getRows(w);
  };
  const [eq, abs, rg, cp] = await Promise.all([lire(n.equipe), lire(n.absence, { actif: true }), lire(n.regle, { actif: true }), lire(n.copies, { actif: true })]);
  return {
    fuseau_horaire: fuseau,
    personnes: eq.map((p) => ({
      id: p.id, nom: p.nom, email: p.email, role: p.role, actif: p.actif !== false, assistante_id: p.assistante || null,
      temps: p.temps || "plein", jours: ids(p.jours).map(Number),
      remplacant_hors_jours: ref(p.remplacant_hors_jours), remplacant_inactif: ref(p.remplacant_inactif),
    })),
    regles: rg.map((r) => {
      /* un groupe ou une agence : les personnes de l'équipe qui en font partie aujourd'hui */
      const membres = (champ) => (r[champ] === null || r[champ] === undefined || r[champ] === "" ? [] : eq.filter((p) => String(p[champ] ?? "") === String(r[champ])).map((p) => String(p.id)));
      const groupe = [...new Set([...ids(r.negociateurs), ...(r.negociateur ? [String(r.negociateur)] : []), ...membres("groupe"), ...membres("agence")])];
      const cibleVide = !groupe.length && [r.groupe, r.agence].some((x) => x !== null && x !== undefined && x !== "");
      return {
        /* un groupe ou une agence vide ne devient pas « tous » : la règle ne vise personne */
        individuelle: !!r.negociateur && !ids(r.negociateurs).length && !membres("groupe").length && !membres("agence").length,
        id: r.id, nom: r.nom, cible: groupe.length ? { negociateurs: groupe } : cibleVide ? { negociateurs: [] } : { tous: true }, couper_negociateur: !!r.couper_negociateur,
        assistante: modeAssistante(r.assistante), assistante_remplacante: ref(r.assistante_remplacante),
        adresses_libres: String(r.adresses_libres || "").split(/[\s,;]+/).filter((x) => x.includes("@")), actif: true,
      };
    }),
    absences: abs.map((a) => ({ personne_id: a.personne, debut: jourDe(a.debut, fuseau), fin: jourDe(a.fin, fuseau),
      remplacant: a.remplacant ? ref(a.remplacant) : /@/.test(String(a.remplacant_adresse || "")) ? { email: String(a.remplacant_adresse).trim() } : null, motif: a.motif })),
    siege: cp.filter((d) => !d.portee || d.portee === "tous").map((d) => d.email).filter(Boolean),
  };
};

module.exports = { lireRoutage, jourDe, modeAssistante, NOMS };
