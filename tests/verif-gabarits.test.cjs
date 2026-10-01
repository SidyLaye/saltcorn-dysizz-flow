/* Vérification des anciens gabarits sur les mails reçus : un bon gabarit reste, un champ faux est retiré,
   un gabarit qui lit l'adresse de l'agence ou les mails d'un autre portail est retiré, un gabarit qui ne
   reconnaît rien est retiré ; l'IA apprend la forme des mails que personne ne sait lire. Données fictives. */
"use strict";
const assert = require("assert");
const Module = require("module");
const orig = Module._load;
Module._load = function (req, ...rest) { if (req.startsWith("@saltcorn/")) return class {}; return orig.call(this, req, ...rest); };
const { verifier } = require("../src/lib/leads/verif_gabarits");
const { CONF } = require("./fixtures-leads.cjs");

const PRENOMS = ["Paul Lefèvre", "Jeanne Morel", "Louis Garnier", "Anne Roussel", "Marc Fabre", "Julie Perrin"];
const lbc = (i) => ({ id: i + 1, date: `2026-09-${10 + i}T08:00:00Z`, expediteur: `"x via leboncoin" <r${i}abc@messagerie.leboncoin.fr>`, destinataire: "cahors@agence-exemple.fr",
  objet: `Nouveau message pour "Maison 5 pièces" sur leboncoin`,
  texte: `Bonjour Martin Durand - Agence Exemple,\nVous avez un nouveau message.\nE-mail : prospect${i}@example.org\n${PRENOMS[i]}\n« Bonjour, est-il possible de visiter ? »\nRépondre dans la messagerie\nMaison 5 pièces 120 m²\n245000 €\nRéférence : 3012${i}\nLien : https://www.leboncoin.fr/ad/ventes_immobilieres/${i}\nContact agence : cahors@agence-exemple.fr\nL'équipe leboncoin` });
const inconnu = (i) => ({ id: 100 + i, date: `2026-09-2${i}T08:00:00Z`, expediteur: "<alerte@nouveau-portail.example>", objet: "Demande de visite",
  texte: `Nouvelle demande sur Nouveau Portail\nNom du demandeur : Client${i} Durand\nAdresse mail : client${i}@example.org\nAnnonce numéro : NP${i}000\nMerci de le recontacter.` });
const sig = (extra = {}) => JSON.stringify({ expediteur: "messagerie\\.leboncoin\\.fr$", ancres: ["Vous avez un nouveau message"], ...extra });
const lignes = [
  { id: 1, source: "leboncoin", nature: "lead", statut: "actif", version: "bon", signature: sig(), champs: JSON.stringify([
    { nom: "email", motif: "E-mail : (\\S+@\\S+)" }, { nom: "nom_complet", motif: "E-mail : \\S+\\n(.+)" }, { nom: "reference", motif: "Référence : (\\w+)" }, { nom: "message", motif: "«\\s*([^»]+)»" }]) },
  { id: 2, source: "leboncoin", nature: "lead", statut: "actif", version: "nom_faux", signature: sig(), champs: JSON.stringify([
    { nom: "email", motif: "E-mail : (\\S+@\\S+)" }, { nom: "nom_complet", motif: "Bonjour ([^,]+)," }, { nom: "reference", motif: "Référence : (\\w+)" }]) },
  { id: 3, source: "leboncoin", nature: "lead", statut: "actif", version: "email_agence", signature: sig(), champs: JSON.stringify([
    { nom: "email", motif: "Contact agence : (\\S+)" }, { nom: "reference", motif: "Référence : (\\w+)" }]) },
  { id: 4, source: "nulle_part", nature: "lead", statut: "actif", signature: JSON.stringify({ expediteur: "nulle-part\\.example$", ancres: ["jamais"] }), champs: JSON.stringify([{ nom: "email", motif: "(\\S+@\\S+)" }]) },
  { id: 5, source: "SeLoger", nature: "lead", statut: "actif", version: "autre_portail", signature: JSON.stringify({ ancres: ["Vous avez un nouveau message"] }), champs: JSON.stringify([
    { nom: "email", motif: "E-mail : (\\S+@\\S+)" }, { nom: "reference", motif: "Référence : (\\w+)" }]) },
  { id: 6, source: "leboncoin", nature: "lead", statut: "quarantaine", signature: sig(), champs: "[]" },
];
const mails = [0, 1, 2, 3, 4, 5].map(lbc).concat([1, 2, 3, 4].map(inconnu));
/* IA simulée : lit les mails du nouveau portail et propose des motifs */
let appels = 0;
const ia = { lire: async (m, t) => {
  appels++;
  const g = (re) => (t.match(re) || [])[1] || null;
  const nomc = g(/Nom du demandeur : (.+)/) || "";
  return { sortie: { nature: "lead", source: "Nouveau Portail", confiance_nature: 0.95, email: g(/Adresse mail : (\S+)/), prenom: nomc.split(" ")[0], nom: nomc.split(" ")[1], reference: g(/Annonce numéro : (\w+)/),
    motif_email: "Adresse mail : (\\S+)", motif_nom: "Nom du demandeur : \\S+ (\\S+)", motif_prenom: "Nom du demandeur : (\\S+)", motif_reference: "Annonce numéro : (\\w+)", signature_ancre: "Nouvelle demande sur Nouveau Portail" } };
} };

(async () => {
  const R = await verifier({ lignes, mails, conf: CONF, ia, iaMax: 20 });
  const v = (id) => R.detail.find((x) => x.id === id);
  assert.strictEqual(R.gabarits, 5, "seuls les gabarits actifs sont vérifiés");
  assert.strictEqual(v(1).verdict, "fiable", JSON.stringify(v(1)));
  assert.strictEqual(v(1).champs.email.accord, 6); assert.strictEqual(v(1).champs.message.statut, "gardé (message)");
  assert.strictEqual(v(2).verdict, "corrigé", JSON.stringify(v(2)));
  assert.match(v(2).champs.nom_complet.statut, /retiré/, "le mauvais nom est retiré (refusé dès la lecture ou compté faux)"); assert.strictEqual(v(2).champs.email.statut, "fiable");
  assert.strictEqual(v(3).verdict, "retiré", JSON.stringify(v(3)));
  assert.ok(v(3).champs.email.raisons["adresse de l'agence"], "l'adresse de l'agence n'est jamais celle du prospect");
  assert.strictEqual(v(4).verdict, "retiré"); assert.match(v(4).raison, /aucun des mails/);
  assert.strictEqual(v(5).verdict, "retiré"); assert.match(v(5).raison, /autre portail/);
  /* gardés : prêts à lire seuls, avec seulement les champs vérifiés */
  const g2 = R.gardes.find((g) => /^ambs:2:/.test(g.origine));
  assert.deepStrictEqual(g2.champs.map((c) => c.nom), ["email", "reference"]);
  assert.strictEqual(g2.statut, "actif"); assert.ok(g2.nb_observations >= 3);
  assert.strictEqual(R.gardes.length, 2);
  /* les mails lus par les règles ne coûtent aucun appel ; l'IA apprend la forme du nouveau portail */
  assert.ok(appels > 0 && appels <= 4, "IA seulement pour les mails que personne ne sait lire : " + appels);
  assert.ok(R.appris.crees >= 1, JSON.stringify(R.appris));
  const json = JSON.stringify({ ...R, gardes: undefined, nouveaux: undefined });
  for (const x of ["prospect0@example.org", "Lefèvre", "30120", "client1@example.org"]) assert.ok(!json.includes(x), "rapport sans donnée personnelle : " + x);
  /* plafond d'appels respecté */
  appels = 0; await verifier({ lignes, mails, conf: CONF, ia, iaMax: 1 }); assert.strictEqual(appels, 1);
  console.log(`gabarits vérifiés OK : ${R.fiables} fiable, ${R.corriges} corrigé, ${R.retires} retirés, ${R.appris.crees} appris par l'IA`);
})().catch((e) => { console.error(e); process.exit(1); });
