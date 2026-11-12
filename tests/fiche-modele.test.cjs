"use strict";
/* Fiche PDF sur les modèles de Sidy (12/11) : « Selection Habitat » quand le nom de l'agence du bien contient « selection »,
   sinon « Agence Hamilton » ; tout vient de l'annonce, rien n'est rédigé ; en anglais, jamais de français */
const assert = require("node:assert/strict");
const F = require("../src/lib/leads/fiche-modele");
const BIEN = { id: 1, type: "maison", pieces: 5, chambres: 3, surface: 140, ville: "LUNAC", code_postal: "12270", prix: 225000, agence_id: "404862",
  annonce: { criteres: [{ id: 26, nom: "N° Mandat", valeur: "30880", nature: "texte" }, { id: 1929, nom: "Honoraires Vendeur", valeur: 23000, nature: "nombre" },
    { id: 99, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" }, { id: 2, nom: "Taxe foncière", valeur: 1127, nature: "nombre" }, { id: 49, nom: "Nombre places parking", valeur: 2, nature: "nombre" },
    { id: 51, nom: "Année construction", valeur: 1800, nature: "nombre" }, { id: 1850, nom: "Date établissement Diagnostic Energétique", valeur: "21/08/2024", nature: "texte" },
    { id: 2736, nom: "Montant minimum estimé des dépenses annuelles d'énergie pour un usage standard", valeur: 3060, nature: "nombre" },
    { id: 2737, nom: "Montant maximum estimé des dépenses annuelles d'énergie pour un usage standard", valeur: 4210, nature: "nombre" }],
    descriptions: [{ langue: "fr", titre: "Ensemble de charme avec gîte.", texte: "Au calme d'un hameau. Une piscine naturelle. L'agence Hamilton vous accueille." },
      { langue: "en", titre: "Charming property with a gîte", texte: "In a quiet hamlet. A natural swimming pool." }],
    pieces: [{ piece: "Séjour", surface: 27, niveau: "", commentaire: "Séjour. TOMETTES INSERT DANS CHEMINEENiveau : RDC." }, { piece: "Cuisine", surface: 10, niveau: "", commentaire: "Cuisine. TOMETTES" },
      { piece: "Chambre 1", surface: 10, niveau: "", commentaire: "Chambre 1. PARQUETNiveau : 1er étage." }, { piece: "Cave", surface: 30, niveau: "", commentaire: "30M²" }] } };
const photos = ["https://x.fr/1.jpg", "https://x.fr/2.jpg", "data:image/jpeg;base64,AAAA", "http://pas-sur.fr/4.jpg"];
const contact = { nom: "Paul Durand", telephone: "+33616060323", email: "paul@exemple.fr" };

/* choix du modèle par le nom de l'agence */
assert.equal(F.themeDe("SELECTION HABITAT RODEZ"), "sh"); assert.equal(F.themeDe("MVP TRANSACTIONS BY SELECTION MED"), "sh"); assert.equal(F.themeDe("Sélection Ocean"), "sh");
assert.equal(F.themeDe("AGENCE HAMILTON MIREPOIX"), "hamilton"); assert.equal(F.themeDe("ARIEG'IMMO FOIX"), "hamilton"); assert.equal(F.themeDe(""), "hamilton");

const d = F.donneesFiche(BIEN, { langue: "fr", photos, contact, agence: { nom: "SELECTION HABITAT RODEZ" }, quand: new Date("2026-11-12T10:00:00Z") });
assert.equal(d.theme, "sh"); assert.equal(d.mandat, "30880"); assert.equal(d.titre, "Ensemble de charme avec gîte"); assert.equal(d.lieu, "LUNAC (12)");
assert.equal(d.honoraires, "Honoraires à la charge du vendeur", "qui paie les honoraires, jamais leur montant");
assert.deepEqual(d.photos, photos.slice(0, 3), "seulement les photos https ou intégrées");
assert.equal(d.contact.telephone, "06 16 06 03 23"); assert.equal(d.contact.agence, "Sélection Habitat Rodez");
assert.ok(!d.paragraphes.join(" ").includes("Hamilton"), "une phrase qui signe une agence est retirée");
assert.deepEqual(d.groupes.map((g) => [g.titre, g.lignes.map((l) => l.join("|").replace(/\u00a0/g, " "))]), [["Rez-de-chaussée", ["Séjour|27 m²|Tomettes insert dans cheminee", "Cuisine|10 m²|Tomettes"]],
  ["1er étage", ["Chambre 1|10 m²|Parquet", "Cave|30 m²|"]]], "pièces par niveau, sans le nom répété ni une surface seule");
assert.match(d.dpe.note.replace(/\u00a0/g, " "), /entre 3 060 € et 4 210 €\. Diagnostic établi le 21\/08\/2024\./);
const html = F.htmlFiche(d), texte = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/data:[^"')]+/g, "");
assert.ok(/Sélection Habitat/.test(texte) && /www\.selectionhabitat\.com/.test(texte) && !/agence-hamilton/.test(texte), "marque Selection Habitat");
assert.ok(!/1127|Taxe|23000|23 000/.test(texte), "aucun autre montant que le prix et les dépenses d'énergie du DPE");
assert.ok(/Mandat n° 30880/.test(html) && /Paul Durand/.test(texte) && /paul@exemple\.fr/.test(texte), "mandat et contact du modèle");

const h = F.htmlFiche(F.donneesFiche(BIEN, { photos, contact, agence: { nom: "AGENCE HAMILTON CORDES-SUR-CIEL" } })).replace(/data:[^"')]+/g, "");
assert.ok(/www\.agence-hamilton\.com/.test(h) && /Agence Hamilton Cordes-sur-Ciel/.test(h) && !/selectionhabitat\.com/.test(h), "marque Agence Hamilton");

const en = F.donneesFiche(BIEN, { langue: "en", photos, contact, agence: { nom: "SELECTION HABITAT RODEZ" } });
assert.equal(en.titre, "Charming property with a gîte"); assert.equal(en.groupes.length, 0, "pièces non traduites : pas de liste");
assert.ok([...en.carac.bien, ...en.carac.confort, ...en.carac.ext].every(([l]) => !/Nombre|Mode Chauffage|Année/.test(l)), "aucun libellé français en anglais");
assert.equal(F.donneesFiche(null), null);
console.log("fiche-modele OK : choix du modèle par l'agence, données de l'annonce seules, pièces par niveau, anglais sans français");
