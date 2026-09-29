/* Construit la configuration du moteur (dysizz-flow, lib/leads) depuis les tables ld_*.
   Références de personnes dans les tables : « p:<id de ligne> » ou une adresse e-mail. */
"use strict";
const { tables } = require("./schema");

const liste = (s) => String(s || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const json = (s, def) => { if (!s) return def; if (typeof s === "object") return s; try { return JSON.parse(s); } catch (e) { return def; } };
const DEFAUT = {
  crm: "immofacile", mode: "ombre", envoi_mails: false, consentement_actif: true, consentement_libelle: "Demande de contact via {portail} du {date}", utiliser_relais: true,
  id_crm_liens: "immo-facile-(\\d{8})\\b\n/fiches/[\\w-]*_(\\d{8})/", prefixe_secrets: "LEADS_CRM",
  notifier_relances: "negociateur", commentaire_max: 6000, retention_jours: 0,
};

const reglages = async () => {
  const t = await tables();
  const r = (await t.reglages.getRows({}, { orderBy: "id", limit: 1 }))[0] || {};
  const o = { ...DEFAUT };
  for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== "") o[k] = v;
  return o;
};

const charger = async () => {
  const t = await tables();
  const R = await reglages();
  const [agences, personnes, regles, absences, origines, siege, portails] = await Promise.all([t.agences.getRows({}), t.personnes.getRows({}), t.regles.getRows({}), t.absences.getRows({}), t.origines.getRows({}), t.siege.getRows({}), t.portails.getRows({})]);
  const lignes = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const idMoteur = new Map(personnes.map((p) => [p.id, p.crm_id ? String(p.crm_id) : "p" + p.id]));
  const ref = (s) => { const v = String(s || "").trim(); if (!v) return null; const m = v.match(/^p:(\d+)$/); if (m) return idMoteur.has(+m[1]) ? { personne: idMoteur.get(+m[1]) } : null; return /@/.test(v) ? { email: v } : null; };
  /* personnes visées par une règle ou une copie : liste choisie, membres d'un groupe, d'une agence */
  const vivants = personnes.filter((p) => p.actif !== false);
  const membres = (x) => {
    const out = new Set();
    for (const v of liste(x.negociateurs || x.personnes)) { const r = ref(/^\d+$/.test(v) ? "p:" + v : v); if (r && r.personne) out.add(r.personne); }
    if (x.groupe) for (const p of vivants) if (String(p.groupe) === String(x.groupe)) out.add(idMoteur.get(p.id));
    if (x.agence) for (const p of vivants) if (String(p.agence_crm_id) === String(x.agence)) out.add(idMoteur.get(p.id));
    return [...out];
  };
  /* une règle sans cible vise tout le monde ; un groupe ou une agence vide ne vise personne */
  const cibleDe = (r) => {
    if (r.tous) return { tous: true };
    const m = membres(r);
    if (m.length) return { negociateurs: m };
    return r.groupe || r.agence || String(r.negociateurs || "").trim() ? { negociateurs: [] } : { tous: true };
  };
  const conf = {
    domaines_agence: liste(R.domaines_agence), sites: json(R.sites, []), objets_campagnes: String(R.objets_campagnes || "").split("\n").map((x) => x.trim()).filter(Boolean),
    id_crm_liens: String(R.id_crm_liens || "").split("\n").map((x) => x.trim()).filter(Boolean), origines_portail: json(R.origines_portail, {}),
    utiliser_relais: R.utiliser_relais !== false,
    /* étapes coupées par le client (tout est actif par défaut) */
    etapes: json(R.etapes, {}),
    notifier_relances: R.notifier_relances || "negociateur",
    marges_projet: json(R.marges_projet, {}),
    commentaire: { max: +R.commentaire_max || 6000 },
    action_lead: (() => { const v = R.action_lead || json(R.crm_reglages, {}).action_lead; return v ? (isFinite(+v) ? +v : v) : null; })(),
    portails: portails.filter((p) => p.actif !== false).map((p) => ({ id: "declare_" + p.id, nom: p.nom, domaines: liste(p.domaines), objets_lead: lignes(p.objets_lead), objets_non_lead: lignes(p.objets_non_lead), libelles: json(p.libelles, {}), reference: p.reference || null, nature: p.nature || "lead" })),
    agences: agences.filter((a) => a.actif !== false).map((a) => ({ id: String(a.crm_id || "a" + a.id), nom: a.nom, boites: liste(a.boites), negociateur_defaut: a.negociateur_defaut ? (ref(a.negociateur_defaut) || {}).personne || a.negociateur_defaut : null })),
    origines: origines.map((o) => ({ id: o.crm_id ? (isFinite(+o.crm_id) ? +o.crm_id : o.crm_id) : null, code: o.code, libelle: o.libelle })),
    consentement: { actif: !!R.consentement_actif, libelle: R.consentement_libelle },
    routage: {
      personnes: personnes.map((p) => ({ id: idMoteur.get(p.id), ligne: p.id, nom: p.nom, alias: String(p.alias || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean), email: p.email, role: p.role || "negociateur", actif: p.actif !== false, agence_id: p.agence_crm_id,
        assistante_id: p.assistante ? idMoteur.get(p.assistante) : null, temps: p.temps || "plein", jours: liste(p.jours).map(Number).filter((n) => n >= 1 && n <= 7), remplacant_hors_jours: ref(p.remplacant_hors_jours),
        remplacant_inactif: ref(p.remplacant_inactif), groupe: p.groupe || null })),
      regles: regles.filter((r) => r.actif !== false).map((r) => ({ id: "r" + r.id, libelle: r.libelle, cible: cibleDe(r),
        couper_negociateur: !!r.couper_negociateur, assistante: r.assistante || "garder", assistante_remplacante: ref(r.assistante_remplacante), adresses_libres: liste(r.adresses_libres) })),
      absences: absences.filter((a) => a.actif !== false).map((a) => ({ personne_id: idMoteur.get(a.personne), debut: a.debut, fin: a.fin, remplacant: ref(a.remplacant), motif: a.motif || "congés" })),
      siege: siege.filter((s) => s.actif !== false && (!s.portee || s.portee === "tous")).map((s) => s.email),
      /* copies ciblées : les membres de l'agence ou du groupe au moment de l'envoi, ou des personnes choisies */
      copies: siege.filter((s) => s.actif !== false && s.portee && s.portee !== "tous" && s.email).map((s) => ({ email: s.email, nom: s.libelle || s.email, cible: { negociateurs: membres(s) } })),
    },
  };
  /* équipe et règles d'envoi lues dans d'autres tables (ex. les écrans Gestion d'une application) :
     {"equipe":"equipe","absence":"absence","regle":"regle_envoi","copies":"destinataire_custom","id":"user_id"} */
  const rt = json(R.routage_tables, null);
  if (rt && typeof rt === "object") {
    const { id, fuseau, ...noms } = rt;
    const lu = await require("../routage-tables").lireRoutage(noms, fuseau || "Europe/Paris", { id });
    conf.routage = { ...lu, personnes: lu.personnes.map((p) => ({ ...p, alias: p.alias || [] })) };
  }
  const crm = { type: R.crm, reglages: json(R.crm_reglages, {}), prefixe: R.prefixe_secrets || "LEADS_CRM", mode: R.mode === "reel" ? "reel" : "ombre" };
  return { conf, crm, reglages: R, idMoteur };
};

module.exports = { charger, reglages, liste, json, DEFAUT };
