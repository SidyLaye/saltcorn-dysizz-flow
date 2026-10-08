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
   - copies      : email, libelle, actif, portee : « tous » (chaque lead), « agence » (+ agence), « groupe » (+ groupe),
                   « personnes » (+ personnes : "3,7,9", numéros de l'équipe)
   Règles et copies, conditions facultatives (tout ce qui est rempli doit être vrai) : prix_au_dela, prix_jusqu_a,
   types_bien, codes_postaux (débuts), portails, natures — listes séparées par des virgules.

   Une colonne absente est ignorée : une table plus simple fonctionne aussi. */
"use strict";

const NOMS = { equipe: "equipe", absence: "absence", regle: "regle_envoi", copies: "destinataire_custom" };
const { aCondition, listeDe } = require("./routage");

/* condition d'une ligne (règle ou copie), ou null si rien n'est rempli */
const conditionDe = (x) => {
  const c = { prix_au_dela: +x.prix_au_dela > 0 ? +x.prix_au_dela : null, prix_jusqu_a: +x.prix_jusqu_a > 0 ? +x.prix_jusqu_a : null,
    types_bien: listeDe(x.types_bien), codes_postaux: listeDe(x.codes_postaux), portails: listeDe(x.portails), natures: listeDe(x.natures) };
  return aCondition(c) ? c : null;
};

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

/* opts.id : colonne de l'équipe qui porte l'identifiant utilisé ailleurs (ex. l'id du négociateur dans le CRM,
   comme sur les biens) ; sans elle, le numéro de ligne de l'équipe. */
const lireRoutage = async (noms = {}, fuseau = "Europe/Paris", opts = {}) => {
  const conf = await lireRoutageLignes(noms, fuseau);
  return opts.id ? versIdentifiant(conf, conf.__equipe, opts.id) : (delete conf.__equipe, conf);
};

/* remplace chaque numéro de ligne de l'équipe par l'identifiant choisi (les personnes sans cet identifiant gardent « e<numéro> ») */
const versIdentifiant = (conf, eq, champ) => {
  const m = new Map(eq.map((p) => [String(p.id), p[champ] !== null && p[champ] !== undefined && p[champ] !== "" ? String(p[champ]) : "e" + p.id]));
  const id = (x) => (x === null || x === undefined ? x : m.get(String(x)) || String(x));
  const ref = (r) => (r && r.personne !== undefined ? { ...r, personne: id(r.personne) } : r);
  const out = {
    ...conf,
    personnes: conf.personnes.map((p) => ({ ...p, ligne: p.id, id: id(p.id), assistante_id: id(p.assistante_id), remplacant_hors_jours: ref(p.remplacant_hors_jours), remplacant_inactif: ref(p.remplacant_inactif) })),
    regles: conf.regles.map((r) => ({ ...r, cible: r.cible && r.cible.negociateurs ? { negociateurs: r.cible.negociateurs.map(id) } : r.cible, assistante_remplacante: ref(r.assistante_remplacante) })),
    absences: conf.absences.map((a) => ({ ...a, personne_id: id(a.personne_id), remplacant: ref(a.remplacant) })),
    copies: conf.copies.map((c) => ({ ...c, cible: c.cible.tous ? c.cible : { negociateurs: c.cible.negociateurs.map(id) } })),
  };
  delete out.__equipe;
  return out;
};

const lireRoutageLignes = async (noms = {}, fuseau = "Europe/Paris") => {
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
    __equipe: eq,
    personnes: eq.map((p) => ({
      id: p.id, nom: p.nom, email: p.email, role: p.role, actif: p.actif !== false, assistante_id: p.assistante || null,
      /* agence CRM de la personne : sert à retrouver l'agence d'un lead quand le CRM ne la donne pas sur le bien */
      agence_id: p.agency_id ?? p.agence_crm_id ?? null,
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
        id: r.id, nom: r.nom, cible: groupe.length ? { negociateurs: groupe } : cibleVide ? { negociateurs: [] } : { tous: true }, condition: conditionDe(r), couper_negociateur: !!r.couper_negociateur,
        assistante: modeAssistante(r.assistante), assistante_remplacante: ref(r.assistante_remplacante),
        adresses_libres: String(r.adresses_libres || "").split(/[\s,;]+/).filter((x) => x.includes("@")), actif: true,
      };
    }),
    absences: abs.map((a) => ({ personne_id: a.personne, debut: jourDe(a.debut, fuseau), fin: jourDe(a.fin, fuseau),
      remplacant: a.remplacant ? ref(a.remplacant) : /@/.test(String(a.remplacant_adresse || "")) ? { email: String(a.remplacant_adresse).trim() } : null, motif: a.motif })),
    siege: cp.filter((d) => (!d.portee || d.portee === "tous") && !conditionDe(d)).map((d) => d.email).filter(Boolean),
    /* copies ciblées : les membres de l'agence ou du groupe aujourd'hui, ou les personnes choisies */
    copies: cp.filter((d) => d.email && ((d.portee && d.portee !== "tous") || conditionDe(d))).map((d) => {
      const par = (champ) => (d[champ] === null || d[champ] === undefined || d[champ] === "" ? [] : eq.filter((p) => String(p[champ] ?? "") === String(d[champ])).map((p) => String(p.id)));
      const vises = d.portee === "agence" ? par("agence") : d.portee === "groupe" ? par("groupe") : d.portee === "personnes" ? ids(d.personnes) : [];
      const tous = !d.portee || d.portee === "tous";
      return { email: d.email, nom: d.libelle || d.email, cible: tous ? { tous: true } : { negociateurs: [...new Set(vises)] }, condition: conditionDe(d) };
    }),
  };
};

module.exports = { lireRoutage, jourDe, modeAssistante, conditionDe, NOMS };
