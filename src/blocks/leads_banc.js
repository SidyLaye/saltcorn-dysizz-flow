/* Banc d'essai des leads : rejoue le moteur sur les mails d'un ancien système et compare avec ses résultats.
   Lecture seule (CRM en mémoire, rempli avec le catalogue de l'ancien système) ; le rapport, sans donnée
   personnelle, est rangé dans Fichiers (lisible par l'administrateur seulement). */
"use strict";
const CAT = "Leads immobiliers";
const lu = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { return d; } };

const DEFAUT = {
  mails: { table: "email_brut_selection_habitat", expediteur: "expediteur", destinataire: "destinataire", objet: "objet", texte: "corps_texte", html: "corps_html", date: "date_envoi" },
  leads: { table: "lead", mail: "email_brut", source: "source", statut: "statut", reference: "reference_bien", bien: "product_id", agence: "agency_id", negociateur: "user_id" },
  champs: { table: "lead_champ", lead: "lead", nom: "nom_champ", valeur: "valeur" },
  biens: { table: "bien", id: "product_id", reference: "model", prix: "prix", surface: "surface", pieces: "nb_pieces", type: "type_bien", ville: "ville", code_postal: "code_postal", negociateur: "user_id", agence: "agency_id", proprietaire: "customers_id" },
  agences: { table: "agence", id: "agency_id", nom: "nom", boites: ["boite", "emails"] },
};

module.exports = [{
  name: "dzf_leads_banc", label: "Leads : banc d'essai sur les mails d'un ancien système", category: CAT, icon: "fas fa-balance-scale", output: "banc", timeout: 3600,
  description: "Rejoue le traitement des leads sur les mails déjà reçus par un ancien système et compare, mail par mail, avec ce qu'il avait trouvé : source, e-mail, téléphone, nom, prénom, référence, bien, agence, négociateur, décision. Rien n'est écrit (CRM en mémoire). Rapport sans donnée personnelle dans Fichiers : accords par portail et par champ, type de chaque écart, squelette anonymisé des mails en écart.",
  params: [
    { name: "correspondances", label: "Tables et champs de l'ancien système (JSON)", type: "json", help: "Vide = tables AMBS (email_brut_selection_habitat, lead, lead_champ, bien, agence). Ex. {\"mails\":{\"table\":\"mails\"}}" },
    { name: "domaines_agence", label: "Domaines de l'agence", help: "Ex. selectionhabitat.com (mails de l'équipe)" },
    { name: "limite", label: "Nombre de mails (0 = tous)", type: "int", default: 0 },
    { name: "gabarits", label: "Utiliser les gabarits appris (table des gabarits leads)", type: "bool", default: true },
    { name: "exemples", label: "Exemples anonymisés par portail", type: "int", default: 3 },
    { name: "fichier", label: "Nom du rapport", default: "banc-leads.json" },
  ],
  run: async (p, ctx = {}) => {
    const Table = require("@saltcorn/data/models/table");
    const api = require("../api");
    const { banc, champDeLAncien } = require("../lib/leads/banc");
    const K = lu(p.correspondances, {}) || {};
    const c = Object.fromEntries(Object.entries(DEFAUT).map(([k, v]) => [k, { ...v, ...(K[k] || {}) }]));
    const T = (n) => { const t = Table.findOne({ name: n }); if (!t) throw Object.assign(new Error(`table « ${n} » introuvable`), { permanent: true }); return t; };
    const lotParLot = async (t, f) => { for (let depuis = 0; ; ) { const l = await t.getRows({ id: { gt: depuis } }, { orderBy: "id", limit: 1000 }); if (!l.length) break; for (const r of l) f(r); depuis = l[l.length - 1].id; } };

    /* mails */
    const mails = [];
    await lotParLot(T(c.mails.table), (r) => { if (!p.limite || mails.length < +p.limite) mails.push({ id: r.id, expediteur: r[c.mails.expediteur], destinataire: r[c.mails.destinataire], objet: r[c.mails.objet], texte: r[c.mails.texte], html: r[c.mails.html], date: r[c.mails.date] }); });
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
      ville: r[c.biens.ville], code_postal: r[c.biens.code_postal], negociateur_id: r[c.biens.negociateur], agence_id: r[c.biens.agence], proprietaire_id: r[c.biens.proprietaire] }));
    const agences = [];
    if (Table.findOne({ name: c.agences.table })) await lotParLot(T(c.agences.table), (r) => agences.push({ id: String(r[c.agences.id] ?? r.id), nom: r[c.agences.nom],
      boites: [].concat(c.agences.boites).flatMap((f) => String(r[f] || "").toLowerCase().match(/[\w.+-]+@[\w.-]+/g) || []) }));
    const conf = { domaines_agence: String(p.domaines_agence || "").split(/[\s,;]+/).filter(Boolean), agences };
    try { const cd = await require("../lib/leads/tables/conf").charger(); conf.portails = cd.conf.portails; conf.sites = cd.conf.sites; } catch (e) { /* pas de tables leads : portails du code seulement */ }
    const opts = {};
    if (p.gabarits !== false) { try { Object.assign(opts, await require("../lib/leads/tables/gabarits").optionsLecture(api)); delete opts.ia; delete opts.noter; } catch (e) { /* pas de gabarits appris */ } }

    const R = await banc({ mails, anciens, biens, conf, opts, exemples: p.exemples === undefined || p.exemples === null || p.exemples === "" ? 3 : +p.exemples });
    R.le = new Date().toISOString(); R.biens_catalogue = biens.length; R.agences = agences.length; R.champs_ancien_inconnus = inconnus; R.gabarits = !!opts.gabarits;
    const File = require("@saltcorn/data/models/file");
    const nom = String(p.fichier || "banc-leads.json").replace(/[^\w.-]/g, "_");
    await File.from_contents(nom, "application/json", JSON.stringify(R, null, 1), ctx.user && ctx.user.id, 1);
    const acc = Object.values(R.portails).reduce((s, P) => { for (const C of Object.values(P.champs)) for (const [k, v] of Object.entries(C)) if (k === "accord") s.a += v; else s.e += v; return s; }, { a: 0, e: 0 });
    return { fichier: nom, mails: R.mails, erreurs: R.erreurs, accords: acc.a, ecarts: acc.e, cas: R.cas.length, resume: `${R.mails} mails, ${acc.a} accords, ${acc.e} écarts, ${R.erreurs} erreurs — Fichiers → ${nom}` };
  },
}];
