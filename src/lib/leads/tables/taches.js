/* Entretien des leads, à lancer par un workflow (modèle « Leads immobiliers : chaque heure ») :
   - reprise des mails restés sans lead (panne, redémarrage pendant le traitement) ;
   - relecture des mails laissés de côté faute de budget d'IA ;
   - effacement du texte des vieux mails (durée de conservation réglée).
   Aucune minuterie cachée : c'est le workflow qui décide quand. */
"use strict";
const { nom } = require("./schema");

const db = () => require("@saltcorn/data/db");
const S = () => db().getTenantSchema();
const CURSEURS_CRM = globalThis[Symbol.for("dysizz-flow.reprises-crm")] ||
  (globalThis[Symbol.for("dysizz-flow.reprises-crm")] = new Map());

const reprendreMails = async (limite = 100) => {
  const ids = (await db().query(`select m.id from "${S()}"."${nom("mails")}" m where m.recu_le < now() - interval '10 minutes' and m.recu_le > now() - interval '7 days'
    and not exists (select 1 from "${S()}"."${nom("leads")}" l where l.mail_id = m.id) order by m.date_envoi, m.id limit ${Math.max(1, Math.min(+limite || 100, 500))}`)).rows.map((r) => r.id);
  const out = { a_reprendre: ids.length, repris: 0, erreurs: [] };
  for (const id of ids) {
    try { await require("./dossier").traiterMail(id); out.repris++; } catch (e) { out.erreurs.push(`mail ${id} : ${e.message}`); }
  }
  return out;
};

const relireIA = async () => {
  const { reglages } = require("./conf");
  const R = await reglages();
  if (!R.ia_actif) return { relus: 0 };
  const ids = (await db().query(`select mail_id from "${S()}"."${nom("leads")}" where alertes like '%plafond du jour%' and traite_le < date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' and traite_le > now() - interval '3 days' and mail_id is not null order by traite_le limit 50`)).rows.map((r) => r.mail_id);
  let n = 0;
  for (const id of ids) { try { await require("./dossier").traiterMail(id); n++; } catch (e) { /* retenté à la prochaine passe */ } }
  await db().query(`delete from "${S()}"."${nom("ia")}" where quand < now() - interval '90 days'`);
  return { relus: n };
};

const retention = async () => {
  const { reglages } = require("./conf");
  const j = +(await reglages()).retention_jours || 0;
  if (j <= 0) return { effaces: 0 };
  const r = await db().query(`update "${S()}"."${nom("mails")}" set corps_texte = '', corps_html = '', source_eml = '' where date_envoi < now() - ($1 || ' days')::interval and (corps_texte <> '' or corps_html <> '' or source_eml <> '')`, [String(j)]);
  return { effaces: r.rowCount || 0 };
};

const reprendreCrm = async () => {
  const { reglages } = require("./conf");
  if ((await reglages()).mode !== "reel") return { repris: 0 };
  const { tables } = require("./schema");
  const { candidatsCrm, echecsCrm, lignesPeriode } = require("./reprise_crm");
  const fin = new Date(Date.now() - 10 * 60000), debut = new Date(Date.now() - 7 * 864e5);
  const key = S() + ":" + require("./schema").prefixe();
  const candidats = candidatsCrm(await lignesPeriode(debut, fin), debut, fin)
    .filter((x) => !echecsCrm(x).some((e) => /inconnu|ambigu|non exposée|déclaré non conforme/i.test(e.erreur)))
    .sort((a,b) => Number(a.id)-Number(b.id));
  const curseur = CURSEURS_CRM.get(key) || 0;
  const rows = [...candidats.filter(x=>Number(x.id)>curseur), ...candidats.filter(x=>Number(x.id)<=curseur)].slice(0,25);
  const rapport = { candidats: rows.length, repris: 0, encore_en_echec: [], erreurs: [], emails_envoyes: 0 };
  for (const row of rows) {
    try {
      await require("./dossier").traiterMail(row.mail_id);
      const actuel = await (await tables()).leads.getRow({ mail_id: row.mail_id });
      if (echecsCrm(actuel).length || !actuel.contact_crm) rapport.encore_en_echec.push(row.id);
      else rapport.repris++;
    } catch (e) { rapport.erreurs.push({ lead_id: row.id, erreur: String(e.message || e).slice(0, 220) }); }
    CURSEURS_CRM.set(key, Number(row.id));
  }
  return rapport;
};

module.exports = { reprendreMails, reprendreCrm, relireIA, retention };
