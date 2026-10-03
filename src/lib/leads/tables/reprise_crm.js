/* Reprise des seules écritures CRM en échec. Aucun envoi SMTP ici. */
"use strict";
const { tables } = require("./schema");
const { charger } = require("./conf");
const { traiterMail } = require("./dossier");

const ERREURS_CRM = new Set(["creerContact", "majContact", "lierBien", "creerRecherche",
  "majRecherche", "ajouterAction", "ajouterConsentement", "confirmerRgpd"]);
const lire = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v || {}; } catch (_) { return {}; } };
const lignesPeriode = async (debut, fin) => {
  const db = require("@saltcorn/data/db");
  const name = require("./schema").nom("leads");
  return (await db.query(`select id,mail_id,mode,nature,bien_crm,contact_crm,recu_le,statut,dossier
    from "${db.getTenantSchema()}"."${name}" where mode='reel' and recu_le >= $1 and recu_le < $2`,
    [debut, fin])).rows;
};
const echecsCrm = (row) => ((lire(row && row.dossier).execution || {}).resultats || [])
  .filter((x) => x && ERREURS_CRM.has(x.op) && x.fait === false && x.erreur)
  .map((x) => ({ op: x.op, erreur: String(x.erreur).slice(0, 220) }));

const candidatsCrm = (rows, debut, fin) => rows
  .filter((l) => l.mail_id && l.mode === "reel" &&
    Number.isFinite(Date.parse(l.recu_le)) && Date.parse(l.recu_le) >= debut.getTime() &&
    Date.parse(l.recu_le) < fin.getTime() && (echecsCrm(l).length ||
      (l.bien_crm && !l.contact_crm && /^(lead|relance)$/.test(l.nature || ""))))
  .sort((a, b) => Date.parse(a.recu_le) - Date.parse(b.recu_le) || Number(a.id) - Number(b.id));

const rattraperCrm = async ({ debut, fin, suivi = {} } = {}) => {
  const d = new Date(debut), f = fin ? new Date(fin) : new Date();
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(f.getTime()) || f <= d)
    throw new Error("Fenêtre de reprise CRM invalide");
  const { crm } = await charger();
  if (crm.mode !== "reel") throw new Error("Le mode CRM réel doit être activé avant la reprise");
  const t = await tables();
  const choisis = candidatsCrm(await lignesPeriode(d, f), d, f);
  const rapport = { debut: d.toISOString(), fin: f.toISOString(), candidats: choisis.length,
    traites: 0, corriges: 0, encore_en_echec: [], erreurs: [], emails_envoyes_par_ce_bloc: 0 };
  suivi.etape = "reprise CRM sans e-mail";
  suivi.total = choisis.length;
  for (const row of choisis) {
    try {
      await traiterMail(row.mail_id, { forcerOmbre: false });
      rapport.traites++;
      const actuel = await t.leads.getRow({ mail_id: row.mail_id });
      const restants = echecsCrm(actuel);
      if (restants.length) rapport.encore_en_echec.push({ lead_id: row.id, mail_id: row.mail_id, erreurs: restants });
      else rapport.corriges++;
    } catch (e) {
      rapport.erreurs.push({ lead_id: row.id, mail_id: row.mail_id, erreur: String(e.message || e).slice(0, 220) });
    }
    suivi.fait++;
  }
  return rapport;
};

// Reprise explicitement demandée : dernier lead d'abord, puis période entière
// seulement après relecture du consentement réel et du motif demandé.
const reparerCrm = async ({ debut, fin, suivi = {} } = {}) => {
  const d = new Date(debut), f = fin ? new Date(fin) : new Date();
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(f.getTime()) || f <= d)
    throw new Error("Fenêtre de réparation CRM invalide");
  const { crm, conf } = await charger();
  if (crm.mode !== "reel" || !conf.consentement || !conf.consentement.actif)
    throw new Error("Le CRM réel et le consentement doivent être activés");
  const api = require("./core").flowApi();
  const client = api.crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "reel");
  const t = await tables();
  const rows = (await lignesPeriode(d, f)).filter((l) => l.mail_id && l.mode === "reel" &&
    /^(lead|relance)$/.test(l.nature || "") && l.bien_crm &&
    Date.parse(l.recu_le) >= d.getTime() && Date.parse(l.recu_le) < f.getTime())
    .sort((a, b) => Date.parse(a.recu_le) - Date.parse(b.recu_le) || Number(a.id) - Number(b.id));
  const rapport = { debut: d.toISOString(), fin: f.toISOString(), candidats: rows.length,
    dernier: null, poursuite_autorisee: false, traites: 0, confirmes: 0,
    a_verifier: [], erreurs: [], emails_envoyes_par_ce_bloc: 0 };
  if (!rows.length) return rapport;
  suivi.total = rows.length + 1;
  const traiter = async (row) => {
    const r = await traiterMail(row.mail_id, { actualiserConsentement: true });
    const actuel = await t.leads.getRow({ mail_id: row.mail_id });
    const id = actuel && actuel.contact_crm;
    const result = { lead_id: row.id, mail_id: row.mail_id, contact_id: id || null,
      consentement_confirme: false, motif_confirme: false, erreurs: echecsCrm(actuel) };
    if (!id || !/^\d+$/.test(String(id))) return result;
    const contact = await client.contact(id);
    const a = (r.dossier.actions || []).find((x) => x.op === "ajouterConsentement");
    result.consentement_confirme = !!(contact && contact.consentement);
    result.rgpd_confirme = !!(contact && contact.rgpd_consent === true && contact.conformite === 1);
    result.motif_confirme = !!(result.consentement_confirme && a && contact.consentement_detail &&
      contact.consentement_detail.raison === String(a.motif).slice(0, 64));
    result.motif = a ? String(a.motif).slice(0, 64) : null;
    if (!a) result.erreurs.push({ op: "ajouterConsentement", erreur: "aucune écriture de consentement planifiée" });
    return result;
  };
  suivi.etape = "vérification du dernier lead avec le motif actuel";
  try {
    rapport.dernier = await traiter(rows[rows.length - 1]);
    suivi.fait++;
    rapport.poursuite_autorisee = rapport.dernier.consentement_confirme &&
      rapport.dernier.motif_confirme && rapport.dernier.rgpd_confirme && !rapport.dernier.erreurs.length;
  } catch (e) {
    rapport.erreurs.push({ etape: "dernier lead", erreur: String(e.message || e).slice(0, 220) });
  }
  if (!rapport.poursuite_autorisee) return rapport;
  // Le dernier est retraité en dernier également : sur un contact partagé,
  // le consentement final reste celui de sa demande la plus récente.
  for (const row of rows) {
    suivi.etape = `réparation CRM du lead ${row.id}`;
    try {
      const r = await traiter(row);
      rapport.traites++;
      if (r.consentement_confirme && r.motif_confirme && r.rgpd_confirme && !r.erreurs.length) rapport.confirmes++;
      else rapport.a_verifier.push(r);
    } catch (e) {
      rapport.erreurs.push({ lead_id: row.id, mail_id: row.mail_id, erreur: String(e.message || e).slice(0, 220) });
    }
    suivi.fait++;
  }
  return rapport;
};

const reparerSelection = async ({ ids, suivi = {}, actualiserConsentement = true } = {}) => {
  const choisis = [...new Set((Array.isArray(ids) ? ids : String(ids || "").split(/[ ,;]+/)).map(Number))];
  if (!choisis.length || choisis.length > 25 || choisis.some(x => !Number.isSafeInteger(x) || x <= 0))
    throw new Error("Sélection de leads invalide (1 à 25 identifiants)");
  const { crm } = await charger();
  if (crm.mode !== "reel") throw new Error("Le CRM doit être en mode réel");
  const client = require("./core").flowApi().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, "reel");
  const t = await tables();
  const rows = [];
  for (const id of choisis) {
    const row = await t.leads.getRow({ id });
    if (!row || row.mode !== "reel" || !row.mail_id || !row.bien_crm || !/^(lead|relance)$/.test(row.nature || ""))
      throw new Error(`Lead ${id} : demande réelle avec bien confirmé requise`);
    rows.push(row);
  }
  const rapport = { selection: choisis, traites: 0, corriges: 0, resultats: [], erreurs: [], emails_envoyes: 0 };
  suivi.total = rows.length;
  suivi.fait = 0;
  for (const row of rows) {
    suivi.etape = `reprise CRM du lead ${row.id}`;
    try {
      await traiterMail(row.mail_id, { actualiserConsentement });
      const actuel = await t.leads.getRow({ id: row.id });
      const id = actuel && actuel.contact_crm;
      const result = { lead_id: row.id, mail_id: row.mail_id, contact_id: id || null,
        contact_confirme: false, consentement_confirme: false, statut: actuel && actuel.statut,
        erreurs: echecsCrm(actuel) };
      if (id && /^\d+$/.test(String(id))) {
        const contact = await client.contact(id);
        result.contact_confirme = !!(contact && String(contact.id) === String(id));
        result.consentement_confirme = !!(contact && contact.consentement);
        result.rgpd_confirme = !!(contact && contact.rgpd_consent === true && contact.conformite === 1);
        result.consentement_rgpd_confirme = !!(contact && contact.rgpd_consent === true);
        const dossier = lire(actuel.dossier);
        result.projet_id = dossier.execution && dossier.execution.rechercheId || dossier.dossier && dossier.dossier.recherche_id || null;
        result.projet_confirme = !!(contact && result.projet_id && (contact.recherches || []).some(p => String(p.id) === String(result.projet_id)));
      }
      if (!result.contact_confirme || !result.consentement_confirme || !result.rgpd_confirme)
        result.cause = String(actuel && actuel.motifs || "fiche ou consentement non confirmé").slice(0, 300);
      rapport.resultats.push(result);
      rapport.traites++;
      if (result.contact_confirme && result.consentement_confirme && result.rgpd_confirme && !result.erreurs.length) rapport.corriges++;
    } catch (e) { rapport.erreurs.push({ lead_id: row.id, erreur: String(e.message || e).slice(0, 250) }); }
    suivi.fait++;
  }
  return rapport;
};

module.exports = { echecsCrm, candidatsCrm, lignesPeriode, rattraperCrm, reparerCrm, reparerSelection };
