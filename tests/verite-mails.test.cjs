/* Corrections issues de la lecture des vrais mails d'AMBS (structure réelle de chaque portail, données inventées).
   Chaque cas correspond à une erreur constatée en comparant le moteur au contenu réel des mails. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return {}; return orig.call(this, req, ...rest); };
const { extraire } = require("../src/lib/leads/extraire");
const V = require("../src/lib/leads/valeurs");
const { texteMail } = require("../src/lib/leads/texte");
const { rapprocher } = require("../src/lib/leads/rapprochement");
const M = require("../src/lib/leads/crm/memoire");

const CONF = { domaines_agence: ["agence-exemple.fr"], routage: { personnes: [{ id: 1, nom: "Paul Martinez", telephone: "0600000011", email: "paul@agence-exemple.fr" }] }, agences: [{ id: 9, nom: "AGENCE EXEMPLE" }] };
const lire = (m) => extraire(m, CONF);

(async () => {
  /* ---- téléphone : jamais d'indicatif inventé ---- */
  assert.strictEqual(V.telephone("07956288684"), "+447956288684", "11 chiffres commençant par 0 : Royaume-Uni");
  assert.strictEqual(V.telephone("0612345678"), "+33612345678");
  assert.strictEqual(V.telephone("775225352"), "775225352", "9 chiffres sans indicatif : gardé tel quel");
  assert.strictEqual(V.indicatifContexte("775225352", { senegal: true }), "+221775225352");
  assert.strictEqual(V.indicatifContexte("653416521", { email: "x@exemple.nl" }), "+31653416521");
  assert.strictEqual(V.indicatifContexte("876360621", { email: "x@gmail.com" }), null, "pas d'indice : pas d'indicatif");
  assert.strictEqual(V.telephone("+330623022250"), "+33623022250", "0 en trop après +33 (SeLoger)");

  /* ---- surface : jamais celle du terrain ou du jardin ---- */
  assert.strictEqual(V.surface("MAISON FAMILIALE 4 CHAMBRES AVEC JARDIN 2000 M2- VUE"), null);
  assert.strictEqual(V.surface("Belle maison de 140 m² sur un terrain de 1 390 m²"), 140);
  assert.strictEqual(V.surface("Maisons, 120m², 1609m² de terrain"), 120);
  assert.strictEqual(V.surface("Terrain 2244 m² NASSIET"), 2244, "le bien EST un terrain");
  assert.strictEqual(V.surface("12160 Terrain 1500 m² Ref"), 1500, "type « Terrain » suivi de sa surface");
  /* ---- prix ---- */
  assert.strictEqual(V.prix("Annonce maison 259000€/La Canourgue 250m2"), 259000);
  assert.strictEqual(V.prix("600 €/mois"), null);
  assert.strictEqual(V.prix("125 800€ 90.50€/m²"), 125800);

  /* ---- texte : séparateurs abîmés, champs collés ---- */
  const t = texteMail({ texte: "Maison 4 pièces 80 m²86460 VILLAGE 94 000 € et 136���000 € puis VillagePrice: €199,000 avec assez de texte pour être du texte brut" });
  assert.ok(/80 m² 86460/.test(t) && /136 000 €/.test(t) && /\nPrice :/.test(t));

  /* ---- Leboncoin : réponse sans « Référence », prix rappelé avant « Lien » ; ville approximative ---- */
  const lbc = lire({ expediteur: '"jp via leboncoin" <abc123@messagerie.leboncoin.fr>', objet: 'Nouveau message pour "Appartement 3 pièces 69 m²" sur leboncoin',
    texte: "Bonjour AGENCE,\nVous avez un nouveau message.\njp\n« Bonjour, le bien est-il toujours disponible ? »\nRépondre dans la messagerie\nMessages précédents\njp\n14 juil. 2026 08:21:57\nBonjour, merci\nAppartement 3 pièces 69 m²\n110000 €\nLien :\nMerci de votre confiance et à très bientôt,\nL'équipe leboncoin\n" });
  assert.strictEqual(lbc.bien.prix, 110000); assert.strictEqual(lbc.bien.lieu_approche, true);

  /* ---- Green-Acres : carte de l'acheteur prioritaire, référence d'agence, mandat ---- */
  const ga = lire({ expediteur: '"Jeanne Test via Green-Acres" <jeanne-ab12@email.green-acres.com>', objet: "The buyer replied: Demande d'information - Maison - Achat - Village",
    texte: "Jeanne Test has replied to you\nJeanne Test - 1 September 2026 à 17:31\nHello, merci Paul Martinez 06 00 00 00 11\nReply to this email to continue the conversation.\nJeanne Test\n☎\n06 11 22 33 44\n✉\nagence-00aa11bb@email.green-acres.com\n198,000 €\nVillage (81140)\n183 m² – 7 rooms – 3 bedrooms\nReference: 1234567a-1551 Mandat n° 5678\n" });
  assert.strictEqual(ga.contact.telephone, "+33611223344", "la carte de l'acheteur, pas le numéro du négociateur cité dans le fil");
  assert.strictEqual(ga.bien.reference, "1551"); assert.strictEqual(ga.bien.reference_portail, "1234567a-1551");
  assert.deepStrictEqual(ga.bien.references_autres, ["5678"]);
  const gaAg = lire({ expediteur: '"Jeanne Test via Green-Acres" <jeanne-ab12@email.green-acres.com>', objet: "The buyer replied: Demande d'information - Maison - Achat - Village",
    texte: "Jeanne Test has replied to you\nJeanne Test - 1 September 2026 à 17:31\nHello\nReply to this email to continue the conversation.\nSELECTION HABITAT VILLAGE\n☎\n05 00 00 00 00\n✉\nx-ab12@email.green-acres.com\nReference: 1234567a-1551\n" });
  assert.ok(!gaAg.contact.telephone, "carte de l'agence : son numéro n'est pas celui de l'acheteur");

  /* ---- Rightmove : jamais la mention légale ; référence de l'agence ---- */
  const rm = lire({ expediteur: '"Rightmove Overseas" <autoresponder@rightmove.co.uk>', objet: "Rightmove Overseas Qualified Lead Occitanie (Tom Test)",
    texte: "-- From --\nName: Tom Test\nEmail: tom@exemple.co.uk\nPhone: 07956288684\n-- Property --\nAddress: Occitanie, Tarn, Village\nPrice: €199,000\nReference: 12345_12345_32470\nRightmove Group Limited (RMG), Firm Reference No. 491645, is an Appointed Representative\n" });
  assert.strictEqual(rm.bien.reference, "32470"); assert.strictEqual(rm.contact.telephone, "+447956288684"); assert.strictEqual(rm.bien.lieu_approche, true);

  /* ---- Figaro : « Annonce 1234-56789 » → référence de l'agence 1234 ---- */
  const fg = lire({ expediteur: '"Figaro Immobilier" <leads@immobilier.lefigaro.fr>', objet: "Figaro Immobilier vous adresse un contact - Annonce 1234-56789",
    texte: "Bonjour,\nUn internaute vous contacte pour votre annonce 1234-56789 visible sur Figaro Immobilier :\nmaison\n24800\n89m² 6 Pièces\n125 800€\nVoici ses coordonnées :\nEmail : a@exemple.fr\nNom : Test\n" });
  assert.strictEqual(fg.bien.reference, "1234"); assert.strictEqual(fg.bien.reference_portail, "1234-56789");

  /* ---- mail direct : membre de l'équipe, hameçonnage, nom de société ---- */
  const eq = lire({ expediteur: '"Paul Martinez" <paul.perso@gmail.com>', objet: "Re: Demande d'information - Maison", texte: "Bonsoir, je souhaite son mail svp\nPaul" });
  assert.strictEqual(eq.nature, "interne");
  const ph = lire({ expediteur: '"secrétariat comptabilité" <compta@mairie-exemple.fr>', objet: "Re: vous a envoyé Dossier N° 12", html: '<p>Comptabilité a partagé un document avec vous. Expire le 17 août.</p><a href="https://site-inconnu.example/ouvrir">Voir le document</a>' });
  assert.strictEqual(ph.nature, "hameconnage");
  const so = lire({ expediteur: '"A DUPONT RENOVATION SERVICES" <contact.dupont-renov@orange.fr>', objet: "Réf. 2274", texte: "Bonjour\nNous souhaiterions visiter le bien référencé dans le sujet.\nBien cordialement\nLéa MARTIN 06.11.22.33.44 Envoyé depuis l'application Mail Orange" });
  assert.strictEqual(so.contact.prenom, "Léa"); assert.strictEqual(so.contact.nom, "Martin");

  /* ---- démarchage : pas sur un simple mot ---- */
  const vv = lire({ expediteur: '"Morgan via leboncoin" <x1@messagerie.leboncoin.fr>', objet: 'Nouveau message pour "Moulin 10 pièces 227 m²" sur leboncoin', texte: "Bonjour,\nMorgan vous a contacté sur leboncoin.\nPrénom : Morgan\nNom : Test\nE-mail : m@exemple.fr\n« Bonjour, est-ce normal que la visite virtuelle 3d ne fonctionne pas ? »\nRépondre dans la messagerie\nMoulin 10 pièces 227 m²\n325000 €\nRéférence : 1234\n" });
  assert.ok(!vv.suspect, "un acheteur qui parle de la visite virtuelle n'est pas un démarcheur");

  /* ---- rapprochement ---- */
  const cat = [
    { id: 1, reference: "E-32841", prix: 111000, surface: 82.61, pieces: 3, type: "maison", ville: "VILLAGE A", code_postal: "82190" },
    { id: 2, reference: "500", prix: 162000, surface: 125, pieces: 4, type: "maison", ville: "VILLAGE B", code_postal: "82160" },
    { id: 3, reference: "12015378796", prix: 377500, surface: 190, pieces: 9, type: "maison", ville: "VILLAGE C", code_postal: "15220" },
    { id: 4, reference: "1551", prix: 132500, surface: 0, pieces: 5, type: "maison", ville: "VILLAGE D", code_postal: "87330" },
  ];
  const crm = M.creer({ biens: cat });
  /* « Propriété » sur Leboncoin = « Maison » dans le CRM : le type ne filtre plus ; prix + surface + pièces trouvent le bien */
  let r = await rapprocher({ bien: { reference: "1582", type: "propriete", prix: 111000, surface: 83, pieces: 3, lieu_approche: true } }, crm);
  assert.strictEqual(r.bien && r.bien.id, 1, "critères : prix + surface + pièces, type ignoré");
  /* référence donnée mais absente du catalogue (annonce retirée) : le prix et le département seuls ne suffisent jamais */
  r = await rapprocher({ bien: { reference: "29132", prix: 378000, departement: "15" } }, crm);
  assert.strictEqual(r.bien, null, "piège de l'annonce retirée : pas de rapprochement sur prix + département");
  /* prix lu sans autre fait : jamais sur type + pièces seulement */
  r = await rapprocher({ bien: { type: "maison", pieces: 4, surface: 125 } }, crm);
  assert.strictEqual(r.bien, null, "pas de prix : pas de recherche par critères");
  /* référence d'agence exacte, lieu du portail faux (commune lointaine) : acceptée, écart signalé */
  r = await rapprocher({ bien: { reference: "1551", prix: 132500, ville: "Autre", code_postal: "22100", lieu_approche: true } }, crm);
  assert.strictEqual(r.bien && r.bien.id, 4);

  console.log("vérité des mails OK : téléphones, surfaces, prix, texte, Leboncoin, Green-Acres, Rightmove, Figaro, équipe, hameçonnage, société, démarchage, rapprochement");
})().catch((e) => { console.error(e); process.exit(1); });
