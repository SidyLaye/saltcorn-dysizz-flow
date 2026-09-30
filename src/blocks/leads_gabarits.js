/* Vérifier et corriger les gabarits d'un ancien système sur les vrais mails reçus (lib/leads/verif_gabarits).
   Simulation par défaut : rien n'est écrit, le rapport (sans donnée personnelle) arrive dans Fichiers.
   En écriture : les gabarits fiables ou corrigés lisent seuls, les autres sont mis en quarantaine,
   les gabarits appris par l'IA sont ajoutés. */
"use strict";
const CAT = "Leads immobiliers";
const lu = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { return d; } };
const MAILS = { table: "email_brut_selection_habitat", expediteur: "expediteur", destinataire: "destinataire", objet: "objet", texte: "corps_texte", html: "corps_html", date: "date_envoi" };

module.exports = [{
  name: "dzf_leads_gabarits_verifier", label: "Leads : vérifier et corriger les gabarits d'un ancien système", category: CAT, icon: "fas fa-check-double", output: "gabarits", timeout: 3600,
  description: "Pour chaque gabarit actif de l'ancien système : cherche les mails qu'il reconnaît, applique chaque motif et compare, champ par champ, avec la lecture des règles (quand elles lisent tout) ou de l'IA. Un champ est gardé s'il a lu juste au moins 3 fois sans aucune erreur ; sinon il est retiré. Le gabarit est gardé s'il lui reste de quoi joindre le prospect et son nom ou le bien. Les mails que personne ne sait lire sont lus par l'IA, qui apprend de nouveaux gabarits. Simulation par défaut ; rapport sans donnée personnelle dans Fichiers.",
  params: [
    { name: "etape", label: "Étape", type: "select", options: ["simulation", "écriture"], default: "simulation", help: "simulation : rien n'est écrit ; écriture : le résultat remplace les gabarits de l'ancien système dans ld_gabarits" },
    { name: "table", label: "Table des anciens gabarits", type: "table", default: "gabarit_version" },
    { name: "mails", label: "Mails (JSON)", type: "json", help: "Vide = email_brut_selection_habitat. Ex. {\"table\":\"mails\",\"texte\":\"corps\"}" },
    { name: "domaines_agence", label: "Domaines de l'agence (en plus)", help: "Déjà pris : ceux des réglages Leads et des boîtes des agences" },
    { name: "par_gabarit", label: "Mails vérifiés par gabarit (au plus)", type: "int", default: 40 },
    { name: "ia_max", label: "IA : nombre d'appels au plus", type: "int", default: 300, help: "Lecture de référence quand les règles ne lisent pas tout le mail, puis apprentissage de nouveaux gabarits" },
    { name: "apprendre", label: "Apprendre de nouveaux gabarits avec l'IA", type: "bool", default: true },
    { name: "fichier", label: "Nom du rapport", default: "gabarits-verification.json" },
    { name: "arriere_plan", label: "En arrière-plan (le rapport arrive dans Fichiers)", type: "bool", default: true },
  ],
  run: async (p, ctx = {}) => require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_gabarits_verifier", String(p.fichier || "gabarits-verification.json").replace(/[^\w.-]/g, "_"), async (suivi = {}) => {
    const Table = require("@saltcorn/data/models/table");
    const api = require("../api");
    const { verifier } = require("../lib/leads/verif_gabarits");
    const T = (n) => { const t = Table.findOne({ name: n }); if (!t) throw Object.assign(new Error(`table « ${n} » introuvable`), { permanent: true }); return t; };
    const lotParLot = async (t, f) => { for (let depuis = 0; ; ) { const l = await t.getRows({ id: { gt: depuis } }, { orderBy: "id", limit: 1000 }); if (!l.length) break; for (const r of l) f(r); depuis = l[l.length - 1].id; } };
    const c = { ...MAILS, ...(lu(p.mails, {}) || {}) };
    suivi.etape = "lecture des gabarits et des mails";
    const lignes = []; await lotParLot(T(p.table || "gabarit_version"), (r) => lignes.push(r));
    const mails = []; await lotParLot(T(c.table), (r) => mails.push({ id: r.id, expediteur: r[c.expediteur], destinataire: r[c.destinataire], objet: r[c.objet], texte: r[c.texte], html: r[c.html], date: r[c.date] }));
    /* configuration du moteur : réglages Leads (portails déclarés, sites), agences de l'ancien système */
    const conf = {};
    let domR = [], R0 = {};
    try { const cd = await require("../lib/leads/tables/conf").charger(); Object.assign(conf, cd.conf); domR = cd.conf.domaines_agence || []; R0 = cd.reglages || {}; } catch (e) { /* pas de réglages Leads */ }
    const boites = [];
    if (Table.findOne({ name: "agence" })) await lotParLot(T("agence"), (r) => boites.push(...(String(r.boite || "") + " " + String(r.emails || "")).toLowerCase().match(/[\w.+-]+@[\w.-]+/g) || []));
    conf.domaines_agence = require("../lib/leads/banc").domainesAgence(p.domaines_agence, domR, boites);
    const iaMax = p.ia_max === undefined || p.ia_max === null || p.ia_max === "" ? 300 : Math.max(0, +p.ia_max || 0);
    const ia = iaMax ? api.iaDepuisCoffre(R0.ia_fournisseur || "saltcorn", R0.ia_modele || "", "LEADS_IA_CLE", R0.ia_url || undefined) : null;
    const R = await verifier({ lignes, mails, conf, ia, iaMax, parGabarit: Math.max(3, +p.par_gabarit || 40), progres: suivi, apprendre: p.apprendre !== false });
    let ecrit = null;
    if (p.etape === "écriture" || p.etape === "ecriture") { suivi.etape = "écriture dans ld_gabarits"; ecrit = await require("../lib/leads/tables/gabarits").enregistrerVerification(api, R); }
    const rapport = { le: new Date().toISOString(), etape: ecrit ? "écriture" : "simulation", ...R, gardes: undefined, nouveaux: R.nouveaux.map((g) => ({ source: g.source, statut: g.statut, champs: g.champs.map((x) => x.nom), observations: g.nb_observations })), ecrit };
    const File = require("@saltcorn/data/models/file");
    const nom = String(p.fichier || "gabarits-verification.json").replace(/[^\w.-]/g, "_");
    await File.from_contents(nom, "application/json", JSON.stringify(rapport, null, 1), ctx.user && ctx.user.id, 1);
    return { fichier: nom, gabarits: R.gabarits, fiables: R.fiables, corriges: R.corriges, retires: R.retires, appris: R.appris, ia: R.ia, ecrit,
      resume: `${R.gabarits} gabarits : ${R.fiables} fiables, ${R.corriges} corrigés, ${R.retires} retirés ; ${R.appris.crees} appris par l'IA (${R.appris.actifs} actifs) ; ${R.ia.appels} appels à l'IA${ecrit ? " — ÉCRIT" : " — simulation, rien n'est écrit"} — Fichiers → ${nom}` };
  }),
}];
