/* Reprise des seules écritures CRM en échec. Aucun envoi SMTP ici. */
"use strict";
const { tables } = require("./schema");
const { charger } = require("./conf");
const { traiterMail } = require("./dossier");

const ERREURS_CRM = new Set(["creerContact", "majContact", "lierBien", "creerRecherche",
  "majRecherche", "ajouterAction", "ajouterConsentement"]);
const lire = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v || {}; } catch (_) { return {}; } };
const echecsCrm = (row) => ((lire(row && row.dossier).execution || {}).resultats || [])
  .filter((x) => x && ERREURS_CRM.has(x.op) && x.fait === false && x.erreur)
  .map((x) => ({ op: x.op, erreur: String(x.erreur).slice(0, 220) }));

const candidatsCrm = (rows, debut, fin) => rows
  .filter((l) => l.mail_id && l.mode === "reel" &&
    Number.isFinite(Date.parse(l.recu_le)) && Date.parse(l.recu_le) >= debut.getTime() &&
    Date.parse(l.recu_le) < fin.getTime() && echecsCrm(l).length)
  .sort((a, b) => Date.parse(a.recu_le) - Date.parse(b.recu_le) || Number(a.id) - Number(b.id));

const rattraperCrm = async ({ debut, fin, suivi = {} } = {}) => {
  const d = new Date(debut), f = fin ? new Date(fin) : new Date();
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(f.getTime()) || f <= d)
    throw new Error("Fenêtre de reprise CRM invalide");
  const { crm } = await charger();
  if (crm.mode !== "reel") throw new Error("Le mode CRM réel doit être activé avant la reprise");
  const t = await tables();
  const choisis = candidatsCrm(await t.leads.getRows({}), d, f);
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

module.exports = { echecsCrm, candidatsCrm, rattraperCrm };
