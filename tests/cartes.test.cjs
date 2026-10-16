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

(async () => {
  /* l'empreinte change quand l'annonce ou ses photos changent, pas autrement */
  assert.equal(C.empreinte(BIEN), C.empreinte({ ...BIEN }));
  assert.notEqual(C.empreinte(BIEN), C.empreinte({ ...BIEN, prix: 219000 }));
  assert.notEqual(C.empreinte(BIEN), C.empreinte({ ...BIEN, photos: ["z", ...BIEN.photos] }), "nouvelle photo : textes refaits");
  /* revue du 16/10 (Sidy) : un TEXTE par carte, qui met en valeur ce que montre SA photo, avec des émojis ; l'IA voit chaque photo */
  const okT = (t, langue = "fr") => C.verifierTexte(t, donnees, langue);
  assert.equal(okT("🌳 5 505 m² de jardin au calme d'un hameau.\n☀️ De quoi déjeuner dehors dès les beaux jours."), null);
  assert.match(okT("🌳 Un jardin au calme d'un hameau."), /émojis/, "un seul émoji : le texte doit en avoir plusieurs");
  assert.match(okT("🌳 a\n🏡 b\n🔥 c\n☀️ d"), /lignes/, "Meta : 2 sauts de ligne au plus");
  assert.match(okT("🌳 " + "a".repeat(160) + "\n🏡 b"), /longueur/, "160 caractères au plus (Meta)");
  assert.match(okT("🌳 Un jardin au calme.\n📍 À 30 minutes de Rodez."), /nombre/, "les contrôles des lignes valent pour chaque texte");
  assert.match(okT("🏡 Une maison magnifique.\n🌳 Un grand jardin."), /superlatif/);
  const P6 = ["https://x.fr/1.jpg", "https://x.fr/2.jpg", "https://x.fr/3.jpg", "https://x.fr/4.jpg", "https://x.fr/5.jpg", "https://x.fr/6.jpg"];
  /* le travail confié au bot (IA de Botpress, demande de Sidy du 16/10) : la consigne et les photos ; rien si moins de 3 photos */
  const P6B = { ...BIEN, photos: P6 };
  const job = C.travail(P6B);
  assert.deepEqual(Object.keys(job).sort(), ["bien_id", "consigne", "empreinte", "photos"]);
  assert.deepEqual(job.photos, P6.slice(0, 5), "la dernière photo est gardée pour la carte du référent");
  assert.equal(job.empreinte, C.empreinte(P6B)); assert.match(job.consigne, /Photo 1 à Photo 5/); assert.match(job.consigne, /2 lignes/);
  assert.match(job.consigne, /aucun montant/i, "le prix est dans le message du carrousel, pas sous les photos");
  assert.ok(!/Honoraires|vendeur/.test(job.consigne.split("DONNÉES")[1]), "données triées");
  assert.equal(C.travail({ ...BIEN, photos: P6.slice(0, 2) }), null, "moins de 3 photos : lignes de secours du bot");
  const sortieIA = {
    fr: { titre: "Maison de charme avec gîte, à Villefranche-de-Rouergue", cartes: [
      { photo: 2, texte: "🌳 5 505 m² de jardin au calme d'un hameau.\n☀️ De quoi déjeuner dehors dès les beaux jours." },
      { photo: 1, texte: "🏡 140 m² et 3 chambres sous un même toit.\n👨‍👩‍👧 De la place pour toute la famille." },
      { photo: 3, texte: "🏊 Une piscine naturelle face à la campagne.\n🌄 Pour se baigner au calme." },
      { photo: 4, texte: "🔥 Un chauffage au bois.\n📍 À 30 minutes de Rodez." },
      { photo: 5, texte: "🛏️ 3 chambres pour la famille.\n🌙 Chacun son espace pour se reposer." }] },
    en: { titre: "Charming house with a gîte", cartes: [{ photo: 1, texte: "🏡 140 m² and 3 bedrooms.\n👨‍👩‍👧 Room for the whole family." }] } };
  const cv = C.recevoirCartes(P6B, JSON.stringify(sortieIA));
  assert.deepEqual(cv.fr.cartes.map((x) => x.image), [P6[0], P6[1], P6[2], P6[4]], "chaque texte reste sous SA photo, dans l'ordre des photos ; le texte fautif (photo 4) est retiré");
  assert.equal(cv.empreinte, C.empreinte(P6B)); assert.ok(cv.refus.some((r) => r.photo === 4));
  assert.equal(cv.fr.cartes[1].texte, "🌳 5 505 m² de jardin au calme d'un hameau.\n☀️ De quoi déjeuner dehors dès les beaux jours.");
  assert.equal(cv.en, undefined, "moins de 3 textes valides : la langue n'est pas rendue");
  assert.equal(C.recevoirCartes(P6B, "pas du JSON"), null, "réponse illisible : rien");
  assert.equal(okT("🌿 Un coin frais à l'ombre du figuier.\n☀️ Pour déjeuner dehors."), null, "« frais » au sens de fraîcheur n'est pas un sujet réservé (essai du 16/10)");
  assert.match(okT("🏡 Frais d'agence inclus.\n🌳 Un grand terrain."), /réservé/, "les frais d'agence le restent");
  /* le bot reçoit les textes avec leur photo */
  const B = require("../src/lib/leads/bot");
  assert.deepEqual(B.cartesPourBot({ cartes: cv }).cartes.fr.cartes[0], { image: P6[0], texte: "🏡 140 m² et 3 chambres sous un même toit.\n👨‍👩‍👧 De la place pour toute la famille." });
  console.log("cartes du carrousel (rédigées par l'IA de Botpress, contrôlées par l'application) OK");
})().catch((e) => { console.error(e); process.exitCode = 1; });
