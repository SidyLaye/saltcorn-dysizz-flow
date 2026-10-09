/* Rattrapage de leads précis, avec la version actuelle du plugin.
   - « simuler » : chaque mail est retraité en lecture seule (CRM en ombre, rien d'enregistré, rien d'envoyé) ;
     le rapport dit ce qui serait fait : statut, bien, négociateur, destinataires, écritures CRM.
   - « appliquer » : retraitement réel (écritures CRM, enregistrement du lead), puis, si le lead est prêt, envoi aux
     destinataires une seule fois (même clé que l'envoi normal : un destinataire déjà servi ne reçoit rien de plus).
   Le contact déjà saisi à la main est retrouvé par la recherche du pipeline (e-mail, téléphone) : il est mis à jour,
   pas recréé. */
"use strict";
const ids = (v) => [...new Set(String(v || "").split(/[^0-9]+/).filter(Boolean).map(Number))];

const resume = (l, r) => {
  const d = r.dossier || {}, ex = d.execution || {};
  return {
    lead: l.id, statut_avant: l.statut, statut_apres: r.statut,
    motifs: d.motifs || [], alertes: (d.alertes || []).slice(0, 4),
    bien: d.bien ? `${d.bien.reference || ""} (${d.bien.id})` : null, negociateur: d.negociateur || null,
    destinataires: ((d.destinataires && d.destinataires.liste) || []).map((x) => x.email),
    crm: (ex.resultats || []).map((x) => `${x.op}${x.fait ? " ✓" : x.ignore ? " (sans objet)" : ex.non_automatise ? " (non automatisé)" : x.mode === "ombre" || x.mode ? " (prévu)" : " ✗"}${x.erreur ? " : " + String(x.erreur).slice(0, 80) : ""}`),
  };
};

const rattraper = async (liste, mode = "simuler") => {
  const { tables } = require("./schema");
  const t = await tables();
  const appliquer = mode === "appliquer";
  const out = { mode, leads: [], envoyes: 0, encore_bloques: 0, erreurs: [] };
  for (const id of ids(liste)) {
    try {
      const l = await t.leads.getRow({ id });
      if (!l || !l.mail_id) { out.erreurs.push({ lead: id, erreur: "lead ou mail introuvable" }); continue; }
      const r = await require("./dossier").traiterMail(l.mail_id, { simulation: !appliquer });
      const x = resume(l, r);
      if (r.statut !== "pret") out.encore_bloques++;
      if (appliquer && r.statut === "pret") {
        const d = r.dossier; d.mail_id = d.mail_id || l.mail_id;
        const m = await require("./envoi").messages(d, { id: r.id || l.id, mail_id: l.mail_id });
        if (m.liste.length) { const b = await require("../../envois").envoyer(m.liste, { simuler: m.simuler }); x.envoi = b.resume; out.envoyes++; }
        else x.envoi = m.raison;
      } else if (!appliquer) x.envoi = r.statut === "pret" ? "serait envoyé" : "ne serait pas envoyé";
      out.leads.push(x);
    } catch (e) { out.erreurs.push({ lead: id, erreur: String(e.message || e).slice(0, 220) }); }
  }
  return out;
};

module.exports = { rattraper, ids };
