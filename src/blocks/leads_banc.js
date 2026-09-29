/* Banc d'essai des leads : rejoue le moteur sur les mails d'un ancien système et compare avec ses résultats.
   Lecture seule (CRM en mémoire, rempli avec le catalogue de l'ancien système) ; le rapport, sans donnée
   personnelle, est rangé dans Fichiers (lisible par l'administrateur seulement). */
"use strict";
const CAT = "Leads immobiliers";
const lu = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { return d; } };

const DEFAUT = {
  mails: { table: "email_brut_selection_habitat", expediteur: "expediteur", destinataire: "destinataire", objet: "objet", texte: "corps_texte", html: "corps_html", date: "date_envoi", motif: "motif", regle: "regle_appliquee" },
  leads: { table: "lead", mail: "email_brut", source: "source", statut: "statut", reference: "reference_bien", bien: "product_id", agence: "agency_id", negociateur: "user_id" },
  champs: { table: "lead_champ", lead: "lead", nom: "nom_champ", valeur: "valeur" },
  biens: { table: "bien", id: "product_id", reference: "model", prix: "prix", surface: "surface", pieces: "nb_pieces", type: "type_bien", ville: "ville", code_postal: "code_postal", negociateur: "user_id", agence: "agency_id", proprietaire: "customers_id", cree_le: "cree_le" },
  agences: { table: "agence", id: "agency_id", nom: "nom", boites: ["boite", "emails"] },
  gabarits: { table: "gabarit_version" },
};

module.exports = [{
  name: "dzf_leads_banc", label: "Leads : banc d'essai sur les mails d'un ancien système", category: CAT, icon: "fas fa-balance-scale", output: "banc", timeout: 3600,
  description: "Rejoue le traitement des leads sur les mails déjà reçus par un ancien système et compare, mail par mail, avec ce qu'il avait trouvé : source, e-mail, téléphone, nom, prénom, référence, bien, agence, négociateur, décision. Mesure chaque étage de lecture (règles, gabarits, IA sur un échantillon). Rien n'est écrit (CRM et gabarits en mémoire). Rapport sans donnée personnelle dans Fichiers : accords par portail et par champ, type de chaque écart, squelette anonymisé des mails en écart.",
  params: [
    { name: "correspondances", label: "Tables et champs de l'ancien système (JSON)", type: "json", help: "Vide = tables AMBS (email_brut_selection_habitat, lead, lead_champ, bien, agence). Ex. {\"mails\":{\"table\":\"mails\"}}" },
    { name: "domaines_agence", label: "Domaines de l'agence (en plus)", help: "Déjà pris : ceux des réglages Leads et des boîtes des agences (table des agences)" },
    { name: "limite", label: "Nombre de mails (0 = tous)", type: "int", default: 0 },
    { name: "gabarits", label: "Gabarits", type: "select", options: ["ancien", "appris", "aucun"], default: "ancien",
      help: "ancien = ceux de l'ancien système (table gabarit_version) ; appris = ceux de la solution Leads (ld_gabarits) ; copiés en mémoire, jamais modifiés" },
    { name: "ia_echantillon", label: "IA : nombre de mails lus par l'IA (0 = pas d'IA)", type: "int", default: 100,
      help: "Parmi les mails que ni les règles ni les gabarits ne savent lire, répartis entre les portails. Coûte des appels à l'IA réglée dans les réglages Leads (plafond du jour non compté)." },
    { name: "exemples", label: "Exemples anonymisés par portail", type: "int", default: 3 },
    { name: "fichier", label: "Nom du rapport", default: "banc-leads.json" },
    { name: "arriere_plan", label: "En arrière-plan (le rapport arrive dans Fichiers)", type: "bool", default: true, help: "Décoché : le bouton attend la fin (le proxy peut couper au bout d'une minute : « Bad Gateway »)" },
  ],
  run: async (p, ctx = {}) => require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_banc", String(p.fichier || "banc-leads.json").replace(/[^\w.-]/g, "_"), async (suivi = {}) => {
    const Table = require("@saltcorn/data/models/table");
    const api = require("../api");
    const { banc, champDeLAncien } = require("../lib/leads/banc");
    const K = lu(p.correspondances, {}) || {};
    const c = Object.fromEntries(Object.entries(DEFAUT).map(([k, v]) => [k, { ...v, ...(K[k] || {}) }]));
    const T = (n) => { const t = Table.findOne({ name: n }); if (!t) throw Object.assign(new Error(`table « ${n} » introuvable`), { permanent: true }); return t; };
    const lotParLot = async (t, f) => { for (let depuis = 0; ; ) { const l = await t.getRows({ id: { gt: depuis } }, { orderBy: "id", limit: 1000 }); if (!l.length) break; for (const r of l) f(r); depuis = l[l.length - 1].id; } };

    /* mails */
    suivi.etape = "lecture des mails de l'ancien système";
    const mails = [];
    await lotParLot(T(c.mails.table), (r) => { if (!p.limite || mails.length < +p.limite) mails.push({ id: r.id, expediteur: r[c.mails.expediteur], destinataire: r[c.mails.destinataire], objet: r[c.mails.objet], texte: r[c.mails.texte], html: r[c.mails.html], date: r[c.mails.date], motif_ancien: c.mails.motif ? r[c.mails.motif] : null, regle_ancien: c.mails.regle ? r[c.mails.regle] : null }); });
    /* résultats de l'ancien système */
    const anciens = new Map(), leadVersMail = new Map();
    await lotParLot(T(c.leads.table), (r) => {
      const m = r[c.leads.mail]; if (m === null || m === undefined) return;
      leadVersMail.set(r.id, m);
      anciens.set(m, { source: r[c.leads.source], statut: r[c.leads.statut], reference: r[c.leads.reference], bien: r[c.leads.bien], agence: r[c.leads.agence], negociateur: r[c.leads.negociateur], champs: {} });
    });
    const inconnus = {};
    if (Table.findOne({ name: c.champs.table })) await lotParLot(T(c.champs.table), (r) => {
      const a = anciens.get(leadVersMail.get(r[c.champs.lead])); if (!a) return;
      const k = champDeLAncien(r[c.champs.nom]);
      if (!k) { inconnus[r[c.champs.nom]] = (inconnus[r[c.champs.nom]] || 0) + 1; return; }
      if (r[c.champs.valeur] !== null && r[c.champs.valeur] !== "") a.champs[k] = r[c.champs.valeur];
    });
    /* catalogue et agences de l'ancien système */
    const biens = [];
    if (Table.findOne({ name: c.biens.table })) await lotParLot(T(c.biens.table), (r) => biens.push({ id: r[c.biens.id], reference: r[c.biens.reference], prix: r[c.biens.prix], surface: r[c.biens.surface], pieces: r[c.biens.pieces], type: r[c.biens.type],
      ville: r[c.biens.ville], code_postal: r[c.biens.code_postal], negociateur_id: r[c.biens.negociateur], agence_id: r[c.biens.agence], proprietaire_id: r[c.biens.proprietaire], cree_le: c.biens.cree_le ? r[c.biens.cree_le] : null }));
    const agences = [];
    if (Table.findOne({ name: c.agences.table })) await lotParLot(T(c.agences.table), (r) => agences.push({ id: String(r[c.agences.id] ?? r.id), nom: r[c.agences.nom],
      boites: [].concat(c.agences.boites).flatMap((f) => String(r[f] || "").toLowerCase().match(/[\w.+-]+@[\w.-]+/g) || []) }));
    const conf = { agences };
    let domR = [];
    try { const cd = await require("../lib/leads/tables/conf").charger(); conf.portails = cd.conf.portails; conf.sites = cd.conf.sites; domR = cd.conf.domaines_agence || []; } catch (e) { /* pas de tables leads : portails du code seulement */ }
    conf.domaines_agence = require("../lib/leads/banc").domainesAgence(p.domaines_agence, domR, agences.flatMap((a) => a.boites));
    /* gabarits : copiés en mémoire (le banc n'écrit rien) ; ce que l'IA apprend pendant le banc y reste */
    const A = api.leads.apprentissage, opts = {};
    const choix = p.gabarits === false || p.gabarits === "aucun" ? "aucun" : p.gabarits === "appris" ? "appris" : p.gabarits === true ? "appris ou ancien" : "ancien";
    let depart = [], gabaritsDe = null;
    if (choix !== "aucun") {
      if (choix !== "ancien") { try { const G = require("../lib/leads/tables/gabarits"); const t = await require("../lib/leads/tables/schema").tables(); depart = (await t.gabarits.getRows({})).map(G.versGabarit).filter((g) => g.statut === "actif"); gabaritsDe = "appris"; } catch (e) { depart = []; } }
      if (!depart.length && choix !== "appris" && Table.findOne({ name: c.gabarits.table })) { const l = []; await lotParLot(T(c.gabarits.table), (r) => l.push(r)); depart = A.depuisAmbs(l); gabaritsDe = "ancien"; }
      opts.gabarits = A.memoire(depart);
    }
    /* IA : celle des réglages Leads (clé lue dans le coffre, jamais affichée) */
    const nIA = p.ia_echantillon === undefined || p.ia_echantillon === null || p.ia_echantillon === "" ? 100 : Math.max(0, +p.ia_echantillon || 0);
    if (nIA) {
      let R0 = {}; try { R0 = await require("../lib/leads/tables/conf").reglages(); } catch (e) { /* pas de réglages Leads : IA de Saltcorn */ }
      opts.ia = api.iaDepuisCoffre(R0.ia_fournisseur || "saltcorn", R0.ia_modele || "", "LEADS_IA_CLE", R0.ia_url || undefined);
    }

    suivi.etape = "rejeu du moteur";
    const R = await banc({ mails, anciens, biens, conf, opts, iaEchantillon: nIA, progres: suivi, exemples: p.exemples === undefined || p.exemples === null || p.exemples === "" ? 3 : +p.exemples });
    R.le = new Date().toISOString(); R.biens_catalogue = biens.length; R.agences = agences.length; R.champs_ancien_inconnus = inconnus;
    R.gabarits = { source: gabaritsDe || "aucun", au_depart: depart.length, actifs_au_depart: depart.filter((g) => g.statut === "actif").length }; R.domaines_agence = conf.domaines_agence;
    const File = require("@saltcorn/data/models/file");
    const nom = String(p.fichier || "banc-leads.json").replace(/[^\w.-]/g, "_");
    await File.from_contents(nom, "application/json", JSON.stringify(R, null, 1), ctx.user && ctx.user.id, 1);
    const acc = Object.values(R.portails).reduce((s, P) => { for (const C of Object.values(P.champs)) for (const [k, v] of Object.entries(C)) if (k === "accord") s.a += v; else s.e += v; return s; }, { a: 0, e: 0 });
    const ia = nIA ? `, IA : ${R.ia.echantillon} mails (${R.ia.erreurs} erreurs)` : "";
    return { fichier: nom, mails: R.mails, erreurs: R.erreurs, accords: acc.a, ecarts: acc.e, cas: R.cas.length, gabarits: R.gabarits, ia: R.ia,
      resume: `${R.mails} mails, ${acc.a} accords, ${acc.e} écarts, ${R.erreurs} erreurs, gabarits ${R.gabarits.source} (${R.gabarits.au_depart})${ia} — Fichiers → ${nom}` };
  }),
}];
