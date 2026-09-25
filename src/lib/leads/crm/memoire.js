/* CRM en mémoire : sert aux tests et au mode « répétition » sur un catalogue exporté.
   Même interface que les vrais adaptateurs. */
"use strict";
const { typeBien } = require("../valeurs");
const { cle } = require("../texte");

const creer = ({ biens = [], contacts = [] } = {}) => {
  const B = biens.map((b) => ({ ...b, type: b.type && typeBien(b.type) ? typeBien(b.type) : b.type }));
  const C = contacts.slice();
  const ecritures = [];
  return {
    nom: "memoire",
    ecritures,
    bienParId: async (id) => B.find((b) => String(b.id) === String(id)) || null,
    biensParReference: async (ref) => B.filter((b) => String(b.reference || "").trim().toLowerCase() === String(ref).trim().toLowerCase()).slice(0, 5),
    biensParCriteres: async (q, { max = 2 } = {}) => B.filter((b) =>
      (q.type === undefined || b.type === q.type) && (q.pieces === undefined || +b.pieces === +q.pieces) &&
      (q.surface === undefined || Math.round(+b.surface) === Math.round(+q.surface)) && (q.prix === undefined || +b.prix === +q.prix) &&
      (q.lieu === undefined || cle(b.ville + " " + b.code_postal).includes(cle(q.lieu)))).slice(0, max),
    contactsParEmail: async (e) => C.filter((c) => (c.emails || [c.email]).map((x) => String(x || "").toLowerCase()).includes(String(e).toLowerCase())),
    contactsParTelephone: async (t) => C.filter((c) => (c.telephones || [c.telephone]).includes(t)),
    creerContact: async (c) => { const x = { id: "m" + (C.length + 1), cree_le: new Date().toISOString(), ...c }; C.push(x); ecritures.push({ op: "creerContact", c }); return x; },
    majContact: async (id, champs) => { ecritures.push({ op: "majContact", id, champs }); return { id }; },
    lierBien: async (contactId, bienId, note) => { ecritures.push({ op: "lierBien", contactId, bienId, note }); return true; },
    ajouterConsentement: async (contactId, consent) => { ecritures.push({ op: "ajouterConsentement", contactId, consent: { ...consent, preuves: (consent.preuves || []).map((p) => p.nom) } }); return true; },
  };
};

module.exports = { creer };
