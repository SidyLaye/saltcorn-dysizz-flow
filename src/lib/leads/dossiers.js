/* Dossiers (prospect × bien) : comment on les retrouve et ce qu'on y garde après un traitement.
   Ici en mémoire (tests, rejeu) ; le plugin dysizz-leads fait la même chose sur ses tables.
   Recherche : relais du portail, e-mail, téléphone (9 derniers chiffres). */
"use strict";
const { fusionner } = require("./conversation");

const tel9 = (t) => String(t || "").replace(/\D/g, "").slice(-9);

/* Ce qu'un traitement change dans un dossier (pur : sert aussi au plugin). */
const miseAJour = (ancien, d, exec = {}, quand = new Date()) => {
  const x = d.extraction || {}, cle = (d.dossier && d.dossier.cle) || {};
  const base = ancien || { id: null, cree_le: quand, messages: [] };
  const msgs = fusionner(base.messages || [], (d.fil && d.fil.messages) || []);
  const bienId = (d.bien && d.bien.id) || base.bien_id || null;
  const out = {
    ...base,
    relais: base.relais || cle.relais || null,
    email: base.email || cle.email || null,
    telephone: base.telephone || cle.telephone || null,
    reference: base.reference || cle.reference || null,
    bien_id: bienId,
    bien_ref: (d.bien && d.bien.reference) || base.bien_ref || null,
    contact_id: exec.contactId || base.contact_id || (d.contact && d.contact.id) || null,
    recherche_id: exec.rechercheId || base.recherche_id || null,
    consentement: base.consentement || !!exec.consentement,
    negociateur: d.negociateur || base.negociateur || null,
    agence_id: (d.agence && d.agence.id) || base.agence_id || null,
    portail: d.portail || base.portail || x.portail || null,
    nom: base.nom || (x.contact && (x.contact.nom_complet || [x.contact.prenom, x.contact.nom].filter(Boolean).join(" "))) || null,
    statut: d.statut === "suivi" ? base.statut || "ouvert" : base.statut || "ouvert",
    messages: msgs,
    nb_mails: (base.nb_mails || 0) + 1,
    maj_le: quand,
  };
  /* première réponse de l'équipe : c'est le délai de prise en charge */
  const rep = msgs.find((m) => m.role === "equipe" && m.date && (!out.cree_le || new Date(m.date) >= new Date(base.premiere_demande || out.cree_le)));
  if (!out.premiere_demande) out.premiere_demande = (msgs.find((m) => m.role === "prospect" && m.date) || {}).date || quand;
  if (rep && !out.reponse_le) out.reponse_le = rep.date;
  return out;
};

const memoire = () => {
  const D = [];
  return {
    liste: D,
    trouver: async (c = {}) => D.filter((d) =>
      (c.relais && d.relais && d.relais.toLowerCase() === String(c.relais).toLowerCase()) ||
      (c.email && d.email && d.email.toLowerCase() === String(c.email).toLowerCase()) ||
      (c.telephone && d.telephone && tel9(d.telephone) === tel9(c.telephone))),
    enregistrer: async (d, exec, quand) => {
      if (!d.dossier) return null;
      const ancien = d.dossier.id ? D.find((x) => x.id === d.dossier.id) : null;
      const n = miseAJour(ancien, d, exec, quand);
      if (ancien) Object.assign(ancien, n); else { n.id = "d" + (D.length + 1); D.push(n); }
      return n.id || ancien.id;
    },
  };
};

module.exports = { miseAJour, memoire, tel9 };
