/* Contact CRM du lead.
   Règle client : en cas de conflit, priorité à l'e-mail, puis au contact le plus
   récemment créé. Le téléphone ne sert qu'à défaut d'e-mail réel.
   Mise à jour : on complète les champs vides, on n'écrase jamais l'identité. */
"use strict";

const recent = (xs) => xs.slice().sort((a, b) => String(b.cree_le || "").localeCompare(String(a.cree_le || "")) || (+b.id || 0) - (+a.id || 0))[0];

const resoudreContact = async (c = {}, crm) => {
  const trace = [];
  let parEmail = [], parTel = [];
  if (c.email) parEmail = await crm.contactsParEmail(c.email).catch((e) => { trace.push("recherche par e-mail impossible : " + e.message); return []; });
  if (c.telephone) parTel = await crm.contactsParTelephone(c.telephone).catch((e) => { trace.push("recherche par téléphone impossible : " + e.message); return []; });
  if (parEmail.length) {
    const x = recent(parEmail);
    if (parEmail.length > 1) trace.push(`${parEmail.length} contacts avec cet e-mail : le plus récent est gardé (${x.id})`);
    const autres = parTel.filter((t) => String(t.id) !== String(x.id));
    if (autres.length) trace.push(`le téléphone est aussi sur ${autres.map((t) => t.id).join(", ")} : priorité à l'e-mail`);
    return { contact: x, action: "mettre_a_jour", par: "email", trace };
  }
  if (parTel.length && !c.email) {
    const x = recent(parTel);
    if (parTel.length > 1) trace.push(`${parTel.length} contacts avec ce téléphone : le plus récent est gardé (${x.id})`);
    return { contact: x, action: "mettre_a_jour", par: "telephone", trace };
  }
  if (parTel.length && c.email) trace.push(`téléphone connu sur ${recent(parTel).id} mais e-mail différent : priorité à l'e-mail, nouveau contact`);
  if (!c.email && !c.telephone) return { contact: null, action: "impossible", trace: trace.concat("ni e-mail ni téléphone") };
  return { contact: null, action: "creer", trace };
};

/* Champs à compléter sur un contact existant (jamais d'écrasement). */
const completer = (existant = {}, c = {}) => {
  const patch = {};
  const vide = (v) => v === undefined || v === null || String(v).trim() === "";
  if (vide(existant.prenom) && c.prenom) patch.prenom = c.prenom;
  if (vide(existant.nom) && c.nom) patch.nom = c.nom;
  const tels = [existant.telephone, existant.mobile].filter(Boolean).map((t) => String(t).replace(/\D/g, "").slice(-9));
  if (c.telephone && !tels.includes(c.telephone.replace(/\D/g, "").slice(-9))) {
    const mobile = /^\+33[67]\d{8}$/.test(c.telephone);
    if (mobile && vide(existant.mobile)) patch.mobile = c.telephone;
    else if (!mobile && vide(existant.telephone)) patch.telephone = c.telephone;
    else patch.note_telephone = c.telephone;
  }
  return patch;
};

module.exports = { resoudreContact, completer, recent };
