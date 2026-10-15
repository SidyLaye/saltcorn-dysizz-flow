"use strict";
/* Cartes du carrousel rédigées par l'application (revue du 15/10, § 6.1) : faits de l'annonce seulement, contrôlées ligne à ligne */
const assert = require("node:assert/strict");
const C = require("../src/lib/leads/cartes");

const BIEN = { id: 1, type: "maison", pieces: 5, chambres: 3, surface: 140, ville: "Villefranche-de-Rouergue", prix: 225000, photos: ["a", "b", "c", "d", "e", "f"],
  annonce: { criteres: [{ id: 1, nom: "Surface terrain", valeur: 5505, nature: "nombre" }, { id: 2, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" }],
    descriptions: [{ langue: "fr", titre: "Ensemble de charme avec gîte", texte: "Au calme d'un hameau, à 20 minutes de Villefranche. Une piscine naturelle avec vue sur la campagne. Honoraires à la charge du vendeur." }] } };
const donnees = C.donneesPourCartes(BIEN);
assert.ok(!/Honoraires|vendeur/.test(JSON.stringify(donnees)), "les données envoyées à l'IA sont déjà triées (annonce())");

/* contrôle d'une ligne */
const ok = (l, langue = "fr") => C.verifierLigne(l, donnees, langue);
assert.equal(ok("🌳 5 505 m² de jardin, au calme d'un petit hameau"), null);
assert.equal(ok("📍 À 20 minutes de Villefranche"), null, "durée tirée de la description : permise");
assert.equal(ok("💶 225 000 € pour l'ensemble"), null, "le prix de l'annonce est permis");
assert.match(ok("📍 À 30 minutes de Rodez"), /nombre/, "durée absente de l'annonce");
assert.match(ok("🧾 Taxe foncière de 1 127 €"), /montant/);
assert.match(ok("🏡 Une maison exceptionnelle"), /superlatif/);
assert.match(ok("Maison au calme"), /émoji/);
assert.match(ok("🏡 " + "a".repeat(120)), /longueur/);
assert.match(ok("🏡 Visite possible, appelez le 06 11 22 33 44"), /coordonnée/);
assert.match(ok("🏡 Le vendeur est pressé"), /réservé/);
assert.match(ok("🏡 Superbe maison !"), /superlatif|exclamation/);
assert.match(ok("🔥 Heating: bois", "en"), /français/);
assert.equal(ok("🔥 Wood heating for winter evenings", "en"), null);

/* le nom de la commune n'est pas du français à refuser dans une ligne anglaise (essai réel du 15/10) */
assert.equal(ok("📍 A quiet hamlet, 20 minutes from Villefranche", "en"), null);
assert.equal(C.verifierLigne("📍 20 minutes from Villefranche-de-Rouergue", { ...donnees, ville: "Villefranche-de-Rouergue" }, "en"), null);
/* mise en forme : nombres groupés selon la langue, ponctuation française */
assert.equal(C.mettreEnForme("🌳 Terrain de 5505 m² arboré", "fr"), "🌳 Terrain de 5 505 m² arboré");
assert.equal(C.mettreEnForme("💶 225000 €", "fr"), "💶 225 000 €");
assert.equal(C.mettreEnForme("🧰 Dépendances: grange et four à pain", "fr"), "🧰 Dépendances : grange et four à pain");
assert.equal(C.mettreEnForme("🌳 5505 m² of grounds", "en"), "🌳 5,505 m² of grounds");
assert.equal(C.mettreEnForme("💶 225000 €", "en"), "💶 €225,000");
assert.equal(C.mettreEnForme("🧱 Une maison de 1800", "fr"), "🧱 Une maison de 1800", "une année n'est jamais groupée");

/* génération : lignes fautives retirées, langue gardée seulement avec 3 lignes valides au moins */
const ia = (sortie) => ({ generer: async () => sortie });
(async () => {
  const bon = { fr: { titre: "Maison de charme avec gîte, à Villefranche-de-Rouergue", lignes: ["🏡 140 m², 3 chambres et un gîte : de la place pour recevoir", "🌳 5 505 m² de jardin au calme d'un hameau",
      "🏊 Une piscine naturelle avec vue sur la campagne", "📍 À 30 minutes de Rodez", "💶 225 000 € pour l'ensemble"] },
    en: { titre: "Charming house with a gîte", lignes: ["🏡 140 m², 3 bedrooms and a gîte", "🌳 5,505 m² of garden"] } };
  const c = await C.genererCartes(ia(bon), BIEN);
  assert.equal(c.fr.lignes.length, 4, "la ligne inventée (30 minutes de Rodez) est retirée");
  assert.ok(!c.fr.lignes.some((l) => /Rodez/.test(l)));
  assert.equal(c.en, undefined, "moins de 3 lignes valides en anglais : le bot reprend ses lignes de secours");
  assert.equal(c.empreinte, C.empreinte(BIEN));
  assert.equal(await C.genererCartes({ generer: async () => { throw new Error("IA en panne"); } }, BIEN), null, "IA en panne : rien, jamais d'erreur");
  /* le nombre de lignes demandé suit le nombre de photos (une ligne par photo, la dernière carte est le référent) */
  assert.match(C.consignes(donnees, 6), /exactement 5 lignes/);
  assert.match(C.consignes(donnees, 30), /exactement 9 lignes/);
  /* l'empreinte change quand l'annonce change, pas autrement */
  assert.equal(C.empreinte(BIEN), C.empreinte({ ...BIEN }));
  assert.notEqual(C.empreinte(BIEN), C.empreinte({ ...BIEN, prix: 219000 }));
  /* client IA de l'application : rédaction générique (schéma JSON fourni), en plus de la lecture des mails */
  let recu;
  const client = require("../src/lib/leads/ia").creer({ fournisseur: "test", appeler: async (prompt, schema, nom) => { recu = { prompt, schema, nom }; return '{"fr":{"titre":"T","lignes":[]}}'; } });
  assert.deepEqual(await client.generer("p", C.SCHEMA, "cartes"), { fr: { titre: "T", lignes: [] } });
  assert.equal(recu.nom, "cartes"); assert.equal(recu.schema, C.SCHEMA);
  console.log("cartes rédigées par l'application OK");
})().catch((e) => { console.error(e); process.exitCode = 1; });
