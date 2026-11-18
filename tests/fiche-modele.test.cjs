"use strict";
/* Fiche PDF sur le modèle unifié de Sidy (13/11, feu vert le 17/11) : un seul modèle aux deux marques pour tous les biens, quelle que soit
   l'agence ; tout vient de l'annonce, rien n'est rédigé ; un champ vide retire sa ligne ou son bloc ; en anglais, jamais de français.
   Sidy, 17/11 : ni numéro de mandat, ni téléphone ni e-mail du négociateur (son nom seul), ni honoraires (mention ou montant). */
const assert = require("node:assert/strict");
const F = require("../src/lib/leads/fiche-modele");
const RES = require("../src/lib/leads/fiche-ressources");
const BIEN = { id: 1, type: "maison", pieces: 5, chambres: 3, surface: 140, ville: "LUNAC", code_postal: "12270", prix: 225000, agence_id: "404862",
  annonce: { criteres: [{ id: 26, nom: "N° Mandat", valeur: "30880", nature: "texte" }, { id: 1929, nom: "Honoraires Vendeur", valeur: 23000, nature: "nombre" },
    { id: 99, nom: "Mode Chauffage", valeur: "Bois", nature: "texte" }, { id: 100, nom: "Exposition", valeur: "Sud", nature: "texte" }, { id: 101, nom: "Vue", valeur: "Campagne", nature: "texte" }, { id: 2, nom: "Taxe foncière", valeur: 1127, nature: "nombre" }, { id: 49, nom: "Nombre places parking", valeur: 2, nature: "nombre" },
    { id: 51, nom: "Année construction", valeur: 1800, nature: "nombre" }, { id: 1850, nom: "Date établissement Diagnostic Energétique", valeur: "21/08/2024", nature: "texte" },
    { id: 2736, nom: "Montant minimum estimé des dépenses annuelles d'énergie pour un usage standard", valeur: 3060, nature: "nombre" },
    { id: 2737, nom: "Montant maximum estimé des dépenses annuelles d'énergie pour un usage standard", valeur: 4210, nature: "nombre" },
    { id: 64, nom: "Adresse", valeur: "12 chemin des Lilas", nature: "texte" }, { id: 3001, nom: "Nom du propriétaire", valeur: "Martin Vendeur", nature: "texte" },
    { id: 3002, nom: "Prix net vendeur", valeur: 202000, nature: "nombre" }, { id: 3003, nom: "Informations complémentaires", valeur: "- Menuiseries : BOIS", nature: "texte" }],
    descriptions: [{ langue: "fr", titre: "Ensemble de charme avec gîte.", texte: "Au calme d'un hameau. Une piscine naturelle. L'agence Hamilton vous accueille." },
      { langue: "en", titre: "Charming property with a gîte", texte: "In a quiet hamlet. A natural swimming pool." }],
    pieces: [{ piece: "Séjour", surface: 27, niveau: "", commentaire: "Séjour. TOMETTES INSERT DANS CHEMINEENiveau : RDC." }, { piece: "Cuisine", surface: 10, niveau: "", commentaire: "Cuisine. TOMETTES" },
      { piece: "Chambre 1", surface: 10, niveau: "", commentaire: "Chambre 1. PARQUETNiveau : 1er étage." }, { piece: "Cave", surface: 30, niveau: "", commentaire: "30M²" },
      { piece: "Grange", surface: 76, niveau: "Dépendances", commentaire: "" }] } };
const photos = ["https://x.fr/1.jpg", "https://x.fr/2.jpg", "data:image/jpeg;base64,AAAA", "http://pas-sur.fr/4.jpg"];
const contact = { nom: "Paul Durand", telephone: "+33616060323", email: "paul@exemple.fr" };
const sansRes = (h) => h.replace(/<style>[\s\S]*?<\/style>/, "").replace(/data:[^"')]+/g, "");
/* données interdites : aucun autre montant que le prix et les dépenses d'énergie ; ni vendeur, ni adresse, ni texte libre interne ;
   ni mandat, ni téléphone ni e-mail du négociateur, ni honoraires (Sidy, 17/11), en français comme en anglais */
const INTERDIT = [[/30880|30 880/, "numéro de mandat"], [/mandat|mandate/i, "mention du mandat"], [/\+?33\s?6|06[\s.]?16|0616060323|616060323/, "téléphone du négociateur"],
  [/@|paul@exemple|exemple\.fr/i, "e-mail du négociateur"], [/t[ée]l[ée]phone|phone|e-mail/i, "libellé téléphone ou e-mail"],
  [/honorair|agency fees|fees paid|charge du vendeur|charge de l.acqu[ée]reur|23000|23 000|23,000/i, "honoraires"]];
const controle = (h, langue) => { const t = sansRes(h); for (const [re, quoi] of INTERDIT) assert.ok(!re.test(t), `${quoi} absent (${langue})`); };

/* titre de la couverture coupé comme le modèle, sans mot ajouté ni retiré */
assert.deepEqual(F.couper("Bâtisse en pierre au cœur d'un domaine agricole"), ["Bâtisse en pierre", "au cœur d'un domaine agricole"]);
assert.deepEqual(F.couper("Ensemble de charme avec gîte"), ["Ensemble de charme", "avec gîte"]);
assert.deepEqual(F.couper("Maison en ossature bois de plain pied- Rivière sur Tarn"), ["Maison en ossature bois de plain pied", "Rivière sur Tarn"]);
assert.deepEqual(F.couper("Superbe longère"), ["Superbe longère", ""]);
assert.equal(F.marqueDe("AGENCE HAMILTON MIREPOIX"), "Agence Hamilton"); assert.equal(F.marqueDe("SELECTION HABITAT RODEZ"), "Sélection Habitat");
assert.equal(F.marqueDe("ARIEG'IMMO FOIX"), ""); assert.equal(F.marqueDe(""), "");

const d = F.donneesFiche(BIEN, { langue: "fr", photos, contact, agence: { nom: "SELECTION HABITAT RODEZ" }, quand: new Date("2026-11-17T10:00:00Z") });
assert.equal(d.titre, "Ensemble de charme avec gîte"); assert.equal(d.lieu, "LUNAC (12)");
assert.deepEqual([d.titreCouv, d.sousTitre], ["Ensemble de charme", "avec gîte"]);
assert.ok(!("mandat" in d) && !("honoraires" in d), "ni mandat ni honoraires dans les données de la fiche");
assert.deepEqual(d.photos, photos.slice(0, 3), "seulement les photos https ou intégrées");
assert.deepEqual(d.contact, { nom: "Paul Durand", agence: "Sélection Habitat Rodez", marque: "Sélection Habitat" }, "le nom seul du négociateur, ni téléphone ni e-mail");
assert.ok(!d.paragraphes.join(" ").includes("Hamilton"), "une phrase qui signe une agence est retirée");
assert.deepEqual(d.groupes.map((g) => [g.titre, g.lignes.map((l) => l.join("|").replace(/\u00a0/g, " "))]), [["Rez-de-chaussée", ["Séjour|27 m²|Tomettes insert dans cheminee", "Cuisine|10 m²|Tomettes"]],
  ["1er étage", ["Chambre 1|10 m²|Parquet", "Cave|30 m²|"]], ["Dépendances", ["Grange|76 m²|"]]], "pièces par niveau, sans le nom répété ni une surface seule");
assert.match(d.dpe.note.replace(/\u00a0/g, " "), /entre 3 060 € et 4 210 €\. Diagnostic établi le 21\/08\/2024\./);
assert.ok(![...d.carac.bien, ...d.carac.confort, ...d.carac.ext].some(([l]) => /Menuiseries|Informations/.test(l)), "texte libre « Informations complémentaires » jamais lu");

const html = F.htmlFiche(d), texte = sansRes(html);
controle(html, "fr");
/* le modèle unifié : les deux marques, leurs logos et leurs sites, sur la couverture et la dernière page */
assert.equal(html.split(RES.logo_hamilton_blanc).length - 1, 2, "logo Agence Hamilton deux fois"); assert.equal(html.split(RES.logo_sh_blanc).length - 1, 2, "logo Selection Habitat deux fois");
assert.equal((texte.match(/www\.agence-hamilton\.com/g) || []).length, 2); assert.equal((texte.match(/www\.selectionhabitat\.com/g) || []).length, 2);
assert.ok(/Résumé du bien/.test(texte) && !/Les atouts du bien/.test(texte), "« Résumé du bien » comme le modèle");
assert.ok(/Entités de Selection Groupe/.test(texte) && !/Entiutés/.test(texte), "mention des deux marques, sans la faute du modèle");
assert.ok(/Paul Durand/.test(texte) && /Prix : 225 000 €\./.test(texte.replace(/\u00a0/g, " ")), "nom du négociateur et prix");
assert.ok(/Négociateur immobilier — Sélection Habitat/.test(texte) && /Dossier complet disponible auprès de Paul Durand/.test(texte));
assert.ok(/class="tete or">Dépendances/.test(texte) && /class="tete">Rez-de-chaussée/.test(texte), "bandeau doré pour les dépendances, vert pour les niveaux");
assert.ok(!/1127|1 127|Taxe|23000|23 000|202000|202 000|net vendeur/i.test(texte), "aucun montant d'honoraires, de taxe ni prix net vendeur");
assert.ok(!/Lilas|Martin Vendeur|propriétaire|Menuiseries/i.test(texte), "ni adresse, ni propriétaire, ni texte libre interne");

/* un seul modèle : l'agence ne change que la carte du négociateur */
const h = F.htmlFiche(F.donneesFiche(BIEN, { photos, contact, agence: { nom: "AGENCE HAMILTON CORDES-SUR-CIEL" }, quand: new Date("2026-11-17T10:00:00Z") }));
assert.ok(/Agence Hamilton Cordes-sur-Ciel/.test(h) && /Négociateur immobilier — Agence Hamilton/.test(h)); controle(h, "fr, agence Hamilton");
const neutre = (x) => sansRes(x).replace(/<small>Négociateur immobilier[^<]*<\/small>/, "").replace(/<div class="agence">[^<]*<\/div>/, "");
assert.equal(neutre(h), neutre(html), "même fiche pour une agence Hamilton et une agence Selection Habitat, hors carte du négociateur");

const en = F.donneesFiche(BIEN, { langue: "en", photos, contact, agence: { nom: "SELECTION HABITAT RODEZ" } });
assert.equal(en.titre, "Charming property with a gîte"); assert.deepEqual([en.titreCouv, en.sousTitre], ["Charming property", "with a gîte"]);
assert.equal(en.groupes.length, 0, "pièces non traduites : pas de liste");
assert.ok([...en.carac.bien, ...en.carac.confort, ...en.carac.ext].every(([l]) => !/Nombre|Mode Chauffage|Année/.test(l)), "aucun libellé français en anglais");
const hEnBrut = F.htmlFiche(en), hEn = sansRes(hEnBrut);
controle(hEnBrut, "en");
assert.ok(/Price: €225,000\./.test(hEn) && /Full file available from Paul Durand/.test(hEn) && !/Dossier|Honoraires|Négociateur/.test(hEn), "anglais sans français (hors marques)");

/* champ vide : la ligne ou le bloc disparaît */
const vide = F.donneesFiche({ type: "maison", ville: "RODEZ", code_postal: "12000", annonce: { criteres: [] } }, { photos: [], contact: {} });
const hv = sansRes(F.htmlFiche(vide));
assert.ok(!/class="prix"/.test(hv) && !/class="dpe"/.test(hv) && !/class="carte"/.test(hv) && !/class="resume"/.test(hv) && !/Galerie/.test(hv));
assert.ok(/Dossier complet disponible sur demande/.test(hv) && /Maison à Rodez/.test(hv), "sans annonce : titre fait du type et de la ville, contact sur demande");
/* galerie : dix-huit photos par page, numérotées */
const g = F.htmlFiche({ ...d, photos: Array.from({ length: 37 }, (_, i) => `https://x.fr/${i}.jpg`) });
assert.ok(/Les photos du bien — 1\/2/.test(g) && /Les photos du bien — 2\/2/.test(g) && !/3\/3/.test(g));
assert.equal((g.split('<div class="galerie">')[1].split("</div></section>")[0].match(/background-image/g) || []).length, 18);
assert.equal(F.donneesFiche(null), null);
console.log("fiche-modele OK : modèle unifié pour toutes les agences, données de l'annonce seules, ni mandat ni honoraires ni coordonnées du négociateur (FR et EN), pièces par niveau, anglais sans français");
