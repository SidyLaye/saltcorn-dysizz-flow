/* Dossiers (prospect × bien) sur les tables ld_dossiers / ld_evenements.
   Même contrat que le dépôt en mémoire du moteur (dysizz-flow, lib/leads/dossiers) :
   trouver(cles) → dossiers connus du prospect ; enregistrer(d, execution, quand, mailId) → id. */
"use strict";
const { tables } = require("./schema");

const tel9 = (t) => String(t || "").replace(/\D/g, "").slice(-9);
const MAX_MESSAGES = 300;

const versMoteur = (row, evts) => ({
  id: row.id, relais: row.relais, email: row.email, telephone: row.telephone, reference: row.reference,
  bien_id: row.bien_crm || null, bien_ref: row.bien_ref, contact_id: row.contact_crm || null, recherche_id: row.recherche_crm || null,
  consentement: !!row.consentement, negociateur: row.negociateur || null, agence_id: row.agence || null, portail: row.portail, nom: row.nom, statut: row.statut,
  premiere_demande: row.premiere_demande, reponse_le: row.reponse_le, nb_mails: row.nb_mails || 0, cree_le: row.cree_le, maj_le: row.maj_le,
  messages: evts.map((e) => ({ type: e.type, role: e.role, auteur: e.auteur, via: e.via, date: e.quand ? new Date(e.quand).toISOString() : null, texte: e.texte, source: e.source, empreinte: e.empreinte })),
});

const trouver = async (c = {}) => {
  const t = await tables();
  const ou = [];
  if (c.relais) ou.push({ relais: String(c.relais).toLowerCase() });
  if (c.email) ou.push({ email: String(c.email).toLowerCase() });
  if (c.telephone && tel9(c.telephone).length === 9) ou.push({ tel9: tel9(c.telephone) });
  if (!ou.length) return [];
  const rows = await t.dossiers.getRows({ or: ou }, { orderBy: "maj_le", orderDesc: true, limit: 20 });
  const out = [];
  for (const r of rows) out.push(versMoteur(r, await t.evenements.getRows({ dossier: r.id }, { orderBy: "quand", limit: MAX_MESSAGES })));
  return out;
};

/* miseAJour vient du moteur : une seule règle pour la mémoire et pour les tables. */
const enregistrer = (api) => async (d, exec, quand = new Date(), mailId = null) => {
  if (!d || !d.dossier) return null;
  const t = await tables();
  const ancienRow = d.dossier.id ? await t.dossiers.getRow({ id: +d.dossier.id }) : null;
  const ancien = ancienRow ? versMoteur(ancienRow, await t.evenements.getRows({ dossier: ancienRow.id }, { orderBy: "quand", limit: MAX_MESSAGES })) : null;
  const n = api.leads.dossiers.miseAJour(ancien, d, exec || {}, quand);
  const ligne = {
    relais: n.relais ? String(n.relais).toLowerCase() : null, email: n.email ? String(n.email).toLowerCase() : null, telephone: n.telephone || null, tel9: n.telephone ? tel9(n.telephone) : null,
    reference: n.reference || null, bien_crm: n.bien_id ? String(n.bien_id) : null, bien_ref: n.bien_ref || null,
    contact_crm: n.contact_id && !/^ombre-/.test(String(n.contact_id)) ? String(n.contact_id) : null, recherche_crm: n.recherche_id ? String(n.recherche_id) : null,
    consentement: !!n.consentement, negociateur: n.negociateur ? String(n.negociateur) : null, agence: n.agence_id ? String(n.agence_id) : null,
    portail: n.portail || null, nom: n.nom ? String(n.nom).slice(0, 200) : null, statut: n.statut || "ouvert",
    premiere_demande: n.premiere_demande || null, reponse_le: n.reponse_le || null, derniere_activite: quand, nb_mails: n.nb_mails || 1, maj_le: new Date(),
  };
  let id = ancienRow && ancienRow.id;
  if (id) await t.dossiers.updateRow(ligne, id);
  else id = await t.dossiers.insertRow({ ...ligne, cree_le: new Date() });
  /* messages : seulement les nouveaux (même empreinte = même message) */
  const connues = new Set(((ancien && ancien.messages) || []).map((m) => m.empreinte));
  for (const m of n.messages || []) {
    if (!m.empreinte || connues.has(m.empreinte)) continue;
    connues.add(m.empreinte);
    await t.evenements.insertRow({ dossier: id, mail_id: m.source === "mail" ? mailId : null, type: m.type, role: m.role, auteur: String(m.auteur || "").slice(0, 200), via: m.via || null, quand: m.date || null, texte: String(m.texte || "").slice(0, 20000), source: m.source, empreinte: m.empreinte });
  }
  return id;
};

module.exports = { trouver, enregistrer, tel9, versMoteur };
