/* Reprise des seules écritures CRM en échec. Aucun envoi SMTP ici. */
"use strict";
const { tables } = require("./schema");
const { charger } = require("./conf");
const { traiterMail } = require("./dossier");

const ERREURS_CRM = new Set(["creerContact", "majContact", "lierBien", "creerRecherche",
  "majRecherche", "ajouterAction", "ajouterConsentement"]);
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
      rapport.dernier.motif_confirme && !rapport.dernier.erreurs.length;
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
      if (r.consentement_confirme && r.motif_confirme && !r.erreurs.length) rapport.confirmes++;
      else rapport.a_verifier.push(r);
    } catch (e) {
      rapport.erreurs.push({ lead_id: row.id, mail_id: row.mail_id, erreur: String(e.message || e).slice(0, 220) });
    }
    suivi.fait++;
  }
  return rapport;
};

module.exports = { echecsCrm, candidatsCrm, lignesPeriode, rattraperCrm, reparerCrm };
