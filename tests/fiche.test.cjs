"use strict";
/* Fiche annonce PDF (tâche 9) : photos autorisées, caractéristiques, description nettoyée, langue du lead ; page blanche sans marque */
const assert = require("node:assert/strict");
const B = require("../src/lib/leads/bot");
const BIEN = { id: 1, type: "maison", pieces: 5, chambres: 3, surface: 140, ville: "Villefranche-de-Rouergue", code_postal: "12200", prix: 225000,
  annonce: { criteres: [{ id: 1, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" }, { id: 2, nom: "Taxe foncière", valeur: 1127, nature: "nombre" }],
    descriptions: [{ langue: "fr", titre: "Ensemble de charme avec gîte", texte: "Au calme d'un hameau. Honoraires 5 % à la charge de l'acquéreur. Une piscine naturelle." },
      { langue: "en", titre: "Charming property with a gîte", texte: "In a quiet hamlet. A natural swimming pool." }] } };
const photos = ["https://x.fr/1.jpg", "https://x.fr/2.jpg", "https://x.fr/3.jpg"];

/* 09/11 : modèle de la fiche commerciale des assistantes de SH (demande du 06/11), sans logo (Sidy) */
const fr = B.blocsFiche(BIEN, new Date("2026-10-16T10:00:00Z"), "fr", photos, { nom: "Paul Durand" }, "05 65 70 10 49");
const texte = JSON.stringify(fr);
assert.deepEqual(fr[0], { image: photos[0], hauteur: 330 }, "grande photo en tête");
assert.equal(fr.find((b) => b.majuscules && b.gras).centre, "Ensemble de charme avec gîte", "titre de l'annonce");
assert.ok(fr.some((b) => b.centre === "225 000 €") && fr.some((b) => b.centre === "Paul Durand") && fr.some((b) => /^Standard : 05 65 70 10 49/.test(b.centre || "")), "prix, contact et standard");
assert.ok(texte.includes("Au calme d'un hameau.") && texte.includes("Une piscine naturelle."), "description de l'annonce");
assert.ok(!/Honoraires|1127|Taxe/.test(texte), "rien de la slide 07, aucun montant hors prix");
assert.deepEqual(fr.find((b) => b.grille).grille, photos.slice(1), "les autres photos fournies, en grille, pas plus");
assert.ok(fr.find((b) => b.cles).cles.some(([r, l]) => r === "Intérieur" && l.some(([k, v]) => k === "Mode Chauffage" && v === "Bois")), "caractéristiques rangées par rubrique");
assert.match(fr.find((b) => b.petit).petit, /^Informations de l'annonce au 16\/10\/2026\. Document non contractuel\.$/);

const en = B.blocsFiche(BIEN, new Date("2026-10-16T10:00:00Z"), "en", photos, { nom: "Paul Durand" }, "05 65 70 10 49");
const tEn = JSON.stringify(en);
assert.equal(en.find((b) => b.majuscules && b.gras).centre, "Charming property with a gîte");
assert.ok(tEn.includes("In a quiet hamlet.") && /wood/i.test(tEn) && !/Bois|pièces|Chambres|Caract/.test(tEn), "tout en anglais");
assert.match(en.find((b) => b.petit).petit, /^Listing information as of 16\/10\/2026\. Not a contractual document\.$/);
/* Sidy, 09/11 : aucune marque sur la fiche, ni Hamilton ni SH (titre et description) */
const marque = { ...BIEN, annonce: { ...BIEN.annonce, descriptions: [{ langue: "fr", titre: "AGENCE HAMILTON vous présente une belle maison", texte: "Belle maison au calme. Agence Hamilton Cordes, groupe Selection Habitat. Jardin arboré." }] } };
const tm = JSON.stringify(B.blocsFiche(marque, new Date(), "fr", [], { nom: "Paul Durand" }, "05 65 70 10 49"));
assert.ok(!/hamilton|selection/i.test(tm) && /Belle maison au calme\. Jardin arboré\./.test(tm) && /Maison 5 pièces à Villefranche/.test(tm), "titre neutre et signature retirée");
assert.equal(B.blocsFiche(BIEN, new Date(), "fr", []).filter((b) => b.image || b.grille).length, 0, "sans photo téléchargée : aucune image (jamais « [image : erreur] »)");
console.log("fiche annonce PDF OK");
/* téléchargement des photos de la fiche : https seulement, images JPEG/PNG, taille bornée, 4 au plus, une erreur = photo absente */
(async () => {
  const { telechargerPhotos } = require("../src/lib/leads/tables/bot");
  const rep = (type, n, ok = true) => ({ ok, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array(n).buffer });
  const faux = async (u) => { if (u.includes("panne")) throw new Error("réseau"); if (u.includes("gros")) return rep("image/jpeg", 4e6);
    if (u.includes("html")) return rep("text/html", 10); if (u.includes("absent")) return rep("image/jpeg", 10, false); return rep("image/jpeg", 1000); };
  const m = await telechargerPhotos(["https://x.fr/1.jpg", "http://x.fr/2.jpg", "https://x.fr/panne.jpg", "https://x.fr/gros.jpg", "https://x.fr/html", "https://x.fr/absent.jpg", "https://x.fr/7.jpg"], faux);
  assert.deepEqual([...m.keys()], ["https://x.fr/1.jpg"], "seule la bonne photo des 4 premières adresses https est gardée");
  console.log("photos de la fiche OK");
})().catch((e) => { console.error(e); process.exitCode = 1; });
