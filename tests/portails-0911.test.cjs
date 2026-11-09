/* Portails ajoutés le 09/11 (audit des « non identifiés ») : Maisons & Appartements, Etreproprio, Green-Acres écrivant
   depuis vizzit.com, rapports Hornetsecurity, correspondance Kyero, Instagram ; envois en nombre sans IA.
   Mails fictifs, construits sur la forme des vrais (aucune donnée réelle). */
"use strict";
const assert = require("node:assert/strict"), Module = require("node:module");
const orig = Module._load;
Module._load = function (n, ...rest) { if (n.startsWith("@saltcorn/")) return {}; return orig.call(this, n, ...rest); };
const { extraire } = require("../src/lib/leads/extraire");
const { lire } = require("../src/lib/leads/lecture");
const conf = { domaines_agence: ["agence-exemple.fr"], portails: [], routage: { personnes: [] } };
const lis = (expediteur, objet, texte) => extraire({ expediteur, objet, texte, destinataire: "contact@agence-exemple.fr" }, conf);

(async () => {
  /* Maisons & Appartements : demande sur un bien (fiche + bloc du bien) */
  const ma = lis("Maisons & Appartements <contact@maisonsetappartements.fr>", "Demande d'information concernant un bien - AGENCE EXEMPLE",
    ["Bonjour,", "Un internaute vient de vous adresser une demande. Voici ses coordonnées :", "Nom :  Martin", "Prénom :  Claire", "Téléphone :  06 11 22 33 44",
      "Pays :  FRANCE", "E-mail :  claire.martin@exemple.fr", "Message :  Je vous remercie de m'envoyer un dossier complet.", "Profil de l'acquéreur :",
      "En recherche depuis 1 mois.", "les prix des 2 derniers biens étaient de 300 000 € et 320 000 €", "Villes : Alpha, Beta.", "Sincères salutations.",
      "Cette demande concerne le bien suivant :", "Appartement à vendre - Uchaud", "Référence :  2126", "Prix :  195 000 €", "4 pièces - 86 m²", "[Voir la fiche](https://www.maisonsetappartements.fr/ads?IdAnnonce=1)"].join("\n"));
  assert.equal(ma.portail, "maisons_appartements"); assert.equal(ma.nature, "lead");
  assert.equal(ma.bien.reference, "2126"); assert.equal(ma.bien.prix, 195000); assert.equal(ma.bien.ville, "Uchaud"); assert.equal(ma.bien.type, "appartement");
  assert.equal(ma.bien.pieces, 4); assert.equal(ma.bien.surface, 86); assert.equal(ma.contact.email, "claire.martin@exemple.fr");
  assert.notEqual(ma.bien.prix, 300000, "les prix du profil de l'acquéreur ne sont pas ceux du bien");
  /* rendez-vous, appel, appel entrant : des leads ; le vendeur à estimer : une estimation ; la lettre d'info : non-lead */
  assert.equal(lis("x <a@maisonsetappartements.fr>", "Rendez-vous demandé par un internaute - AGENCE EXEMPLE", "Bonjour").nature, "lead");
  assert.equal(lis("x <a@maisonsetappartements.fr>", "Un internaute désire être appelé - AGENCE EXEMPLE", "Bonjour").nature, "lead");
  const appel = lis("x <a@maisonsetappartements.fr>", "Appel entrant d'un prospect acquéreur", "Bonjour,\nVous avez reçu un appel entrant de 14 minutes.\nVoici son téléphone : 06 55 44 33 22\nSincères salutations.");
  assert.equal(appel.nature, "lead"); assert.equal(appel.contact.telephone, "+33655443322");
  assert.equal(lis("x <a@maisonsetappartements.fr>", "Urgent : souhaitez-vous répondre à ce vendeur?", "Voici les caractéristiques du bien :").nature, "estimation");
  assert.equal(lis("x <a@maisonsetappartements.fr>", "Souhaitez-vous répondre à ce vendeur ?", "Un vendeur vient de réaliser une estimation").nature, "estimation");
  assert.equal(lis("x <news@maisonsetappartements.fr>", "Les news de l'immobilier 🏠 L'actualité à Paris", "les news de l'immobilier").nature, "non_lead");

  /* Etreproprio : mandat dans l'objet et dans le corps ; le titre n'est pas converti en type */
  const ep = lis("EtreProprio <contact@etreproprio.com>", "Lead Acheteur - 29381 - Maison et moulin, piscine sur grand terrain - Êtreproprio.com",
    ["Bonjour,", "Nous avons le plaisir vous transmettre le contact d'un acheteur intéressé par", "l'un de vos biens.", "29381 - Maison et moulin, piscine sur grand terrain",
      "Mandat : 29381", "Détail de l'acheteur :", "Nom : Exemple", "Email : acheteur@exemple.fr", "Téléphone : 06 10 20 30 40", "Message :", "Bonjour, ce bien m'intéresse."].join("\n"));
  assert.equal(ep.portail, "etreproprio"); assert.equal(ep.nature, "lead"); assert.equal(ep.bien.reference, "29381");
  assert.equal(ep.bien.titre, "Maison et moulin, piscine sur grand terrain"); assert.notEqual(ep.bien.type, "terrain", "pas de type tiré du titre");
  assert.equal(lis("x <e@etreproprio.com>", "Anomalie de diffusion", "Bonjour").nature, "non_lead");

  /* Green-Acres écrit depuis vizzit.com : même portail, mêmes règles */
  const gv = lis("\"Yannick via Vizzit\" <abc123@email.vizzit.com>", "Demande d’information Maison - Achat : Castelnaudary 229 000 €", "Nouveau contact sur votre mandat\nRéférence : 941");
  assert.equal(gv.portail, "green_acres"); assert.equal(gv.nature, "lead");

  /* rapports anti-spam Hornetsecurity, correspondance Kyero, Instagram : pas des leads */
  assert.equal(lis("Hornetsecurity <noreply@hornetsecurity.com>", "Rapport de quarantaine du 06.11.2026 08:00 pour contact@agence-exemple.fr", "").nature, "alerte_spam");
  for (const o of ["Kyero.com: Votre facture", "Kyero.com: Merci pour votre paiement", "Kyero.com: [Important] Impossible de prélever", "Kyero.com : Votre rapport hebdomadaire PrimeA", "A note from Kyero", "Flux Ubiflow"])
    assert.equal(lis("Kyero <x@kyero.com>", o, "Bonjour").nature, "non_lead", o);
  assert.equal(lis("Kyero <x@kyero.com>", "Kyero.com: Demande reçue via la réf/id : 32809/546032702", "Bonjour").nature, "lead", "une vraie demande Kyero reste un lead");
  assert.equal(lis("Instagram <no-reply@mail.instagram.com>", "Découvrez des comptes", "x").nature, "non_lead");

  /* envoi en nombre : reste « inconnu », l'IA tranche (rejeu du 09/11 : 16 vrais leads citaient un lien de désinscription,
     réponses à une lettre d'info, pieds de page de portails ; un classement sans IA les aurait ignorés) */
  const pub = { expediteur: "Promo <news@fournisseur-exemple.fr>", objet: "Calendriers 2027, c'est maintenant !", texte: "Découvrez nos offres.\nSe désinscrire", destinataire: "contact@agence-exemple.fr" };
  assert.equal(extraire(pub, conf).nature, "inconnu");
  assert.equal((await lire(pub, conf, {})).nature, "inconnu", "sans IA : à trier par un humain, jamais ignoré d'office");
  console.log("portails du 09/11 OK : Maisons & Appartements, Etreproprio, Green-Acres via Vizzit, Hornetsecurity, Kyero, Instagram ; envois en nombre laissés à l\u0027IA");
})().catch((e) => { console.error(e); process.exitCode = 1; });
