/* Mails fictifs (mêmes mises en page que les vrais portails), partagés par les tests. */
"use strict";
const CONF = {
  domaines_agence: ["agence-exemple.fr", "maison-exemple.com"],
  sites: [{ domaine: "agence-exemple.fr", noms: ["AGENCE EXEMPLE"], origine: "site_agence_exemple", libelle: "Agence Exemple" }, { domaine: "maison-exemple.com", noms: ["MAISON EXEMPLE"], origine: "site_maison_exemple" }],
  id_crm_liens: ["immo-facile-(\\d{6,})"],
  objets_campagnes: ["Notre sélection de la semaine"],
};

const MAILS = {
  leboncoin: { expediteur: '"Paul via leboncoin" <abc123@messagerie.leboncoin.fr>', destinataire: "cahors@agence-exemple.fr", objet: 'Nouveau message pour "Maison 5 pièces 120 m²" sur leboncoin',
    texte: "Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nE-mail : paul.test@example.org\nPaul Lefèvre\n« Bonjour, est-il possible de visiter samedi ? »\nRépondre dans la messagerie\nMaison 5 pièces 120 m²\n245000 €\nRéférence : 30123\nLien : https://www.leboncoin.fr/ad/ventes_immobilieres/1\nL'équipe leboncoin\n" + "x".repeat(40) },
  seloger: { expediteur: "<noreply@lead.seloger.com>", objet: "Un acquéreur est intéressé par un de vos biens",
    texte: "Un acquéreur est intéressé par un de vos biens\nJeanne Martin s'intéresse à ce\n bien\n240 000 €\nCARDAILLAC\n,\n46100\nMaison\n• 5 pièces\n• 105 m²\nRef. de l'annonce :\n 28936\nJeanne Martin\nmailto:jeanne.m@example.org\njeanne.m@example.org\nDécouvrir\n son\n projet\nBonjour, votre bien m'intéresse ! Merci\nmailto:jeanne.m@example.org\nRépondre\ntel:+33611223344\n" },
  figaro: { expediteur: "<contact@immobilier.lefigaro.fr>", objet: "Figaro Immobilier vous adresse un contact - Annonce 2025-32831",
    texte: "Bonjour,\nUn internaute vous contacte pour votre annonce 2025-32831 visible sur [Figaro Immobilier](http://immobilier.lefigaro.fr) :\nmaison\n46600\n141m²\t\t6 Pièces\n199 000€ 1411.35€/m²\nVoici ses coordonnées :\nEmail :\nbrice.test@example.org\nNom :\nGouy\nTéléphone :\n[06 24 47 02 41](tel:06 24 47 02 41)\nSon message :\nBonjour, je suis intéressé par ce bien.\nConseil : La réactivité…\nTransaction :\nvente\nBudget max. :\n219 000\n" },
  french: { expediteur: "<enquiries@french-property.com>", objet: "French-Property.com Enquiry: Heather Walker (119)",
    texte: "Dear Agency,\n----- Enquiry - Ref: 119 -----\nName: Heather Walker\nEmail Address: heather@example.co.uk\nPhone Number: +44 7388 927457\nMessage:\nRequests:\n* More photos\n* Floorplan\nPurchase Timescale: 6-12 months\nProperty Details - Ref: 119\nLovely stone house\n€349,500\nLocation: Poitou-Charentes, Deux-Sèvres (79), Valdelaume\n####\n" },
  ac3: { expediteur: "<no-reply@ac3-groupe.com>", objet: "Demande auprès de AGENCE EXEMPLE", destinataire: "info@agence-exemple.fr",
    texte: "[logo AGENCE EXEMPLE]\nCréation de compte Client sur le site AGENCE EXEMPLE Nego : AGENCE EXEMPLE CAHORS Client : Durand - Célia Email: celia.d@example.org Téléphone : 0652723071\nMessage du client :\nBonjour, cette maison nous intéresse.\nBiens maison à sanilhac (reference : 2289)\n", html: '<a href="https://www.agence-exemple.fr/catalog/">x</a>' },
  green: { expediteur: "<noreply@email.green-acres.com>", objet: "Demande d’information - Maison - Achat - Carcassonne 202m² 599 000 €",
    texte: "Nouveau contact sur votre mandat\nManent Monique - 03/09/2026 à 11:37\nBonjour, est-elle toujours en vente\nMerci\nVos coordonnées ont été transmises.\nManent Monique\n☎\n07 83 73 80 82\n✉\nmonique-ddfd@email.green-acres.com\nAnalyse du profil\nVilla contemporaine\n599 000 €\nCarcassonne (11000)\n202 m² – 6 pièces – 4 chambres\nRéférence : 32129\n" },
  bienici: { expediteur: "<noreply@bienici.com>", objet: "Contact prospect-acquéreur pour votre annonce 32445 à GINALS",
    texte: "Un prospect-acquéreur est intéressé par votre annonce 32445\nSes coordonnéesfasquel jfTéléphone : 06 23 22 23 14\nE-mail : jf@example.fr\nRappel de l’annoncePhoto\nMaison 4 pièces 75 m²\n82330 GINALS\n143 000 €\nRÉFÉRENCE : 32445\n", html: '<a href="https://pro.bienici.com/annonce/immo-facile-60473997?x=1">v</a>' },
  auto: { expediteur: "Bob <bob@example.org>", objet: "Réponse automatique : Notre sélection de la semaine", texte: "Je suis absent jusqu'au 12." },
  spam: { expediteur: "<vendeur@example.org>", objet: "Nettoyage de vitres pour votre agence", texte: "Nous proposons nos services de nettoyage pour vos locaux." },
  transfert: { expediteur: '"info" <info@agence-exemple.fr>', objet: "TR: Nouveau message sur Properstar (#ABC)", texte: "De: \"Properstar\" <x1@reply.properstar.com>\nEnvoyé: lundi\nObjet: Nouveau message sur Properstar (#ABC)\n= Nouveau message de Anna Berg =\nBonjour, je voudrais visiter.\n== Annonce désirée ==\nAppartement 3 pièce(s) 72 m2\n Appartement · 3 Pièces · 2 Chambres · 72 m²\n EUR 118 000\nTéléphone\n+46701234567\nE-mail\nanna@example.se\nID de ton CRM: 61355003\nRéférence: 31000\nCode postal: 87000\nLocalité: Limoges\n" },
};

module.exports = { CONF, MAILS };
