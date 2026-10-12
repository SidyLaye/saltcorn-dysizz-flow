/* Rattrapage de leads, avec la version actuelle du plugin.
   - « simuler » : chaque mail est retraité en lecture seule (CRM en ombre, rien d'enregistré, rien d'envoyé) ;
     le rapport dit ce qui serait fait : statut, bien, négociateur, destinataires, écritures CRM.
   - « appliquer » : retraitement réel (écritures CRM, enregistrement du lead), puis, si le lead est prêt, envoi aux
     destinataires une seule fois (même clé que l'envoi normal : un destinataire déjà servi ne reçoit rien de plus).
   Le contact déjà saisi à la main est retrouvé par la recherche du pipeline (e-mail, téléphone) : il est mis à jour,
   pas recréé.
   Sans liste : « trouver » cherche lui-même ce qui est à rattraper depuis une date (voir plus bas). */
"use strict";
const ids = (v) => [...new Set(String(v || "").split(/[^0-9]+/).filter(Boolean).map(Number))];
const db = () => require("@saltcorn/data/db");

/* Ce qui est à rattraper depuis une date, sans toucher au reste :
   - mails reçus qui n'ont jamais donné de lead (traitement interrompu : verrou, CRM trop lent, rafale) ;
   - leads qu'aucun destinataire n'a reçus et qui sont : prêts ; ou complets (bien + négociateur) et bloqués par le
     seul motif de lecture ; ou sans bien avec une référence courte « introuvable » (référence + suffixe du CRM). */
const trouver = async ({ depuis, sauf = [] } = {}) => {
  const { nom, prefixe } = require("./schema");
  const S = db().getTenantSchema(), d = new Date(depuis);
  if (isNaN(d)) throw new Error("date « depuis » invalide (ex. 2026-10-01)");
  const exclus = new Set(ids(sauf));
  const mails = (await db().query(`select m.id from "${S}"."${nom("mails")}" m where m.recu_le >= $1 and m.recu_le < now() - interval '10 minutes'
    and not exists (select 1 from "${S}"."${nom("leads")}" l where l.mail_id = m.id) order by m.id`, [d])).rows.map((r) => Number(r.id));
  const leads = (await db().query(`select l.id from "${S}"."${nom("leads")}" l where l.recu_le >= $1 and l.traite_le < now() - interval '10 minutes'
    and not exists (select 1 from "${S}"."dzf_envois" e where e.cle like $2::text || l.id || ':%' and e.cle not like $2::text || l.id || ':non-automatise:%')
    and ( (l.statut = 'pret' and coalesce(l.motifs, '') not like '%ancien système%')
       or (l.statut in ('a_verifier', 'a_trier') and coalesce(l.bien_crm, '') <> '' and coalesce(l.negociateur, '') <> ''
           and l.motifs ~ '(complété par l''IA|lu par les règles générales|gabarit pas encore assez confirmé)' and l.motifs not like '% · %')
       or (l.statut in ('a_verifier', 'a_trier') and coalesce(l.bien_crm, '') = '' and l.reference ~ '^[A-Za-z0-9]{2,10}$' and l.motifs like '%référence introuvable%') )
    order by l.id`, [d, prefixe() + "lead-"])).rows.map((r) => Number(r.id)).filter((id) => !exclus.has(id));
  return { mails, leads };
};

const resume = (avant, r) => {
  const d = r.dossier || {}, ex = d.execution || {};
  return {
    ...avant, statut_apres: r.statut,
    motifs: d.motifs || [], alertes: (d.alertes || []).slice(0, 4),
    contact: [d.extraction && d.extraction.contact && [d.extraction.contact.prenom, d.extraction.contact.nom].filter(Boolean).join(" "), d.contact && d.contact.action].filter(Boolean).join(" · "),
    bien: d.bien ? `${d.bien.reference || ""} (${d.bien.id})` : null, negociateur: d.negociateur || null,
    destinataires: ((d.destinataires && d.destinataires.liste) || []).map((x) => x.email),
    crm: (ex.resultats || []).map((x) => `${x.op}${x.fait ? " ✓" : x.ignore ? " (sans objet)" : ex.non_automatise ? " (non automatisé)" : x.mode && x.mode !== "reel" ? " (prévu)" : " ✗"}${x.erreur ? " : " + String(x.erreur).slice(0, 80) : ""}`),
  };
};

/* liste : numéros de leads ; mails : numéros de mails sans lead */
const rattraper = async (liste, mode = "simuler", { mails = [], suivi = null, envoyer = true } = {}) => {
  const { tables } = require("./schema");
  const t = await tables();
  const appliquer = mode === "appliquer";
  const out = { mode, leads: [], prets: 0, envoyes: 0, encore_bloques: 0, erreurs: [] };
  const travaux = [...ids(mails).map((id) => ({ mail: id })), ...ids(liste).map((id) => ({ lead: id }))];
  if (suivi) { suivi.etape = appliquer ? "rattrapage" : "simulation"; suivi.total = travaux.length; }
  for (const w of travaux) {
    try {
      let mailId = w.mail, avant = { mail: w.mail, statut_avant: "(jamais traité)" };
      if (w.lead) {
        const l = await t.leads.getRow({ id: w.lead });
        if (!l || !l.mail_id) { out.erreurs.push({ lead: w.lead, erreur: "lead ou mail introuvable" }); continue; }
        mailId = l.mail_id; avant = { lead: l.id, statut_avant: l.statut };
      }
      const r = await require("./dossier").traiterMail(mailId, { simulation: !appliquer });
      const x = resume(avant, r);
      if (r.id) x.lead = r.id;
      if (r.statut === "pret") out.prets++; else if (!["ignore", "alerte", "suivi"].includes(r.statut)) out.encore_bloques++;
      if (appliquer && r.statut === "pret" && !envoyer) x.envoi = "non envoyé (rattrapage sans envoi)";
      else if (appliquer && r.statut === "pret") {
        const d = r.dossier; d.mail_id = d.mail_id || mailId;
        const m = await require("./envoi").messages(d, { id: r.id || w.lead, mail_id: mailId });
        if (m.liste.length) { const b = await require("../../envois").envoyer(m.liste, { simuler: m.simuler }); x.envoi = b.resume; out.envoyes++; }
        else x.envoi = m.raison;
      } else if (!appliquer) x.envoi = r.statut !== "pret" ? "ne serait pas envoyé" : envoyer ? "serait envoyé" : "prêt, sans envoi (option)";
      out.leads.push(x);
    } catch (e) { out.erreurs.push({ ...w, erreur: String(e.message || e).slice(0, 220) }); }
    if (suivi) suivi.fait++;
  }
  return out;
};

module.exports = { rattraper, trouver, ids };
