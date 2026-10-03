/* Contact CRM du lead.
   Règle client : en cas de conflit, priorité à l'e-mail, puis au contact le plus
   récemment créé. Le téléphone ne sert qu'à défaut d'e-mail réel.
   Mise à jour : on complète les champs vides, on n'écrase jamais l'identité. */
"use strict";

const recent = (xs) => xs.slice().sort((a, b) => String(b.cree_le || "").localeCompare(String(a.cree_le || "")) || (+b.id || 0) - (+a.id || 0))[0];
// Libellés explicites pour une fiche individuelle dont le mail ne donne pas l'identité.
const PRENOM_MANQUANT = "Prénom non communiqué";
const NOM_MANQUANT = "Nom non communiqué";
const emailIndisponible = v => /^email-indisponible-[a-f0-9]{24}@email-indisponible\.invalid$/i.test(String(v || ""));
const emailTelephone = (telephone, site = "") => {
  const n = String(telephone || "").replace(/\D/g, "");
  if (n.length < 9 || n.length > 15) throw new Error("Téléphone valide requis pour une fiche sans e-mail");
  return "email-indisponible-" + require("crypto").createHash("sha256").update(String(site) + ":" + n).digest("hex").slice(0,24) + "@email-indisponible.invalid";
};

const resoudreContact = async (c = {}, crm) => {
  const trace = [];
  let parEmail = [], parTel = [];
  if (c.email) {
    try { parEmail = await crm.contactsParEmail(c.email); }
    catch (e) {
      trace.push("recherche par e-mail impossible : " + e.message);
      return { contact: null, action: "impossible", par: "recherche_email", trace };
    }
  }
  if (!c.email && c.telephone) {
    try { parTel = await crm.contactsParTelephone(c.telephone); }
    catch (e) {
      trace.push("recherche par téléphone impossible : " + e.message);
      return { contact: null, action: "impossible", par: "recherche_telephone", trace };
    }
  }
  if (parEmail.length) {
    const x = recent(parEmail);
    if (parEmail.length > 1) trace.push(`${parEmail.length} contacts avec cet e-mail : le plus récent est gardé (${x.id})`);
    trace.push("priorité à l'e-mail");
    return { contact: x, action: "mettre_a_jour", par: "email", trace };
  }
  if (parTel.length && !c.email) {
    const x = recent(parTel);
    if (parTel.length > 1) trace.push(`${parTel.length} contacts avec ce téléphone : le plus récent est gardé (${x.id})`);
    return { contact: x, action: "mettre_a_jour", par: "telephone", trace };
  }
  if (c.email && c.telephone && typeof crm.contactsParTelephone === "function") {
    try { parTel = (await crm.contactsParTelephone(c.telephone)).filter(x => emailIndisponible(x.email)); }
    catch (e) { return { contact: null, action: "impossible", par: "recherche_telephone", trace: trace.concat("vérification des fiches sans e-mail impossible : " + e.message) }; }
    if (parTel.length) return { contact: recent(parTel), action: "mettre_a_jour", par: "telephone_placeholder", trace };
  }
  if (!c.email && !c.telephone) return { contact: null, action: "impossible", trace: trace.concat("ni e-mail ni téléphone") };
  return { contact: null, action: "creer", trace };
};

/* Champs à compléter sur un contact existant (jamais d'écrasement). */
const completer = (existant = {}, c = {}) => {
  const patch = {};
  const vide = (v) => v === undefined || v === null || String(v).trim() === "";
  if ((vide(existant.prenom) || existant.prenom === PRENOM_MANQUANT) && c.prenom) patch.prenom = c.prenom;
  if ((vide(existant.nom) || existant.nom === NOM_MANQUANT) && c.nom) patch.nom = c.nom;
  const tels = [existant.telephone, existant.mobile].filter(Boolean).map((t) => String(t).replace(/\D/g, "").slice(-9));
  if (emailIndisponible(existant.email) && c.email && !emailIndisponible(c.email)) patch.email = c.email;
  if (c.telephone && !tels.includes(c.telephone.replace(/\D/g, "").slice(-9))) {
    const mobile = /^\+33[67]\d{8}$/.test(c.telephone);
    if (mobile && vide(existant.mobile)) patch.mobile = c.telephone;
    else if (!mobile && vide(existant.telephone)) patch.telephone = c.telephone;
    else patch.note_telephone = c.telephone;
  }
  return patch;
};

module.exports = { resoudreContact, completer, recent, PRENOM_MANQUANT, NOM_MANQUANT, emailIndisponible, emailTelephone };
