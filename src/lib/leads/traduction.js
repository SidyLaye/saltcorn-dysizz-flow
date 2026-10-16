"use strict";
/* Valeurs d'annonce Immofacile (chauffage, construction, vue, stationnement, état, cuisine, exposition…) en anglais, pour un prospect
   qui écrit en anglais. Table établie sur les valeurs réelles de 739 biens. Une valeur dont un morceau n'est pas connu rend null :
   mieux vaut ne rien montrer que montrer du français dans une conversation anglaise. */
const { cle } = require("./texte");

/* expressions, cherchées d'abord (clé : texte sans accent ni casse) */
const EXPRESSIONS = {
  "bon etat": "good condition", "tres bon etat": "very good condition", "tres bon": "very good", "a rafraichir": "to refresh",
  "travaux a prevoir": "work needed", "a rehabiliter": "to restore", "a renover": "to renovate",
  "pierre de taille": "dressed stone", "beton cellulaire": "aerated concrete", "ossature bois": "timber frame", "ossature metallique": "steel frame",
  "pompe a chaleur air eau": "air-to-water heat pump", "pompe a chaleur air air": "air-to-air heat pump", "pompe a chaleur": "heat pump",
  "climatisation reversible": "reversible air conditioning", "chaudiere a granules": "pellet boiler", "poele a granules": "pellet stove",
  "poele hybride bois et granules": "hybrid wood and pellet stove", "gaz de ville": "mains gas", "chauffe eau thermodynamique": "heat-pump water heater",
  "chauffe eau thermodynamique solaire": "heat-pump or solar water heater", "chauffe eau": "water heater", "ballon electrique": "electric water heater",
  "chauffage central": "central heating", "panneaux solaires": "solar panels", "collective avec compteur": "collective, metered",
  "collectif avec comptage individuel": "collective, individually metered",
  "tout a l egout": "mains drainage", "fosse septique": "septic tank", "fosse toutes eaux": "septic tank", "micro station": "micro treatment plant",
  "garage ferme": "closed garage", "garageferme": "closed garage", "garage double": "double garage", "garagedouble": "double garage",
  "garage simple": "single garage", "garagesimple": "single garage", "sous sol": "basement", "soussol": "basement",
  "exterieur et couvert": "outdoor and covered", "grand standing": "luxury", "sans cuisine": "no kitchen", "coin repas": "dining area",
  "semi ouverte": "semi-open", "maison de maitre": "mansion", "maison de ville": "town house", "corps de ferme": "farmhouse",
  "ancienne ferme": "former farm", "sud est": "south-east", "sud ouest": "south-west", "nord est": "north-east", "nord ouest": "north-west",
  "nord sud": "north-south", "est ouest": "east-west",
};
/* mots seuls */
const MOTS = {
  bois: "wood", electrique: "electric", fuel: "oil", gaz: "gas", mixte: "mixed", aucun: "none", sans: "none", geothermie: "geothermal",
  aerothermie: "air-source heating", individuel: "individual", individuelle: "individual", collectif: "collective", thermodynamique: "heat-pump",
  chaudiere: "boiler", pierre: "stone", brique: "brick", parpaing: "breeze block", beton: "concrete", crepis: "render", enduit: "render",
  colombages: "half-timbered", terre: "earth", et: "and",
  degagee: "open", campagne: "countryside", jardin: "garden", panoramique: "panoramic", village: "village", montagne: "mountain", montagnes: "mountains",
  piscine: "pool", pyrenees: "Pyrenees", foret: "forest", riviere: "river", ville: "town", toits: "rooftops", etang: "pond", mer: "sea",
  vignes: "vineyards", lac: "lake", verdure: "greenery", cour: "courtyard", golf: "golf course",
  exterieur: "outdoor", couvert: "covered", aerien: "outdoor", garage: "garage",
  americaine: "open-plan", amenagee: "fitted", equipee: "equipped", independante: "separate", kitchenette: "kitchenette", nue: "unfitted",
  ouverte: "open", meublee: "furnished", simple: "basic",
  sud: "south", nord: "north", est: "east", ouest: "west",
  contemporain: "contemporary", moderne: "modern", villa: "villa", ancien: "period", traditionnel: "traditional", bourgeois: "bourgeois",
  bastide: "bastide", grange: "barn", normal: "standard", excellent: "excellent", habitable: "habitable", moyen: "average", bon: "good", mauvais: "poor",
  oui: "yes", non: "no", conforme: "compliant",
};

const unMorceau = (brut) => {
  const k = cle(brut);
  if (!k) return null;
  if (EXPRESSIONS[k]) return EXPRESSIONS[k];
  if (MOTS[k]) return MOTS[k];
  const mots = k.split(" ");
  if (mots.some((m) => !MOTS[m])) return null;
  /* « Américaine Aménagée Équipée » : adjectifs juxtaposés → virgules ; « Pierre et brique » : connecteur gardé → espaces */
  return mots.map((m) => MOTS[m]).join(mots.includes("et") ? " " : ", ");
};

/* « Bois + Electrique » → « wood + electric » ; « Dégagée, Panoramique » → « open, panoramic » ; « Aerien_Couvert » → « outdoor, covered » */
const traduireValeur = (valeur) => {
  const v = String(valeur == null ? "" : valeur).trim();
  if (!v) return null;
  if (/^([A-G]|\d[\d\s.,]*(\s?(m²|m2|%))?)$/i.test(v)) return v;   // lettre de DPE, nombre, surface
  const plus = v.split(/\s*\+\s*/);
  const out = plus.map((p) => {
    const parts = p.split(/\s*[,_]\s*/).filter(Boolean);
    const t = parts.map(unMorceau);
    return t.includes(null) ? null : t.join(", ");
  });
  return out.includes(null) ? null : out.join(" + ");
};

/* noms de caractéristiques (critères Immofacile) en anglais ; un nom absent d'ici n'est pas montré en anglais */
const NOMS = {
  "mode chauffage": "Heating", "type chauffage": "Heating system", "surface terrain": "Land", "salle s de bains": "Bathrooms",
  "salle s d eau": "Shower rooms", "consommation energie primaire": "Energy rating (DPE)", "gaz effet de serre": "Greenhouse gas (GES)",
  "annee construction": "Year built", "construction": "Construction", "vue": "View", "type de stationnement": "Parking", "piscine": "Pool",
  "etat general": "General condition", "etat exterieur": "Exterior condition", "exposition": "Aspect", "cuisine": "Kitchen", "standing": "Standing",
  "style": "Style", "eau chaude": "Hot water", "assainissement": "Drainage", "nombre etages": "Floors", "nombre de niveaux": "Levels",
  "surface sejour": "Living room", "terrasse": "Terrace", "balcon": "Balcony", "cave": "Cellar", "garage": "Garage", "jardin": "Garden",
  "nombre de wc": "Toilets", "wc": "Toilets", "adsl possible": "Broadband available", "fibre": "Fibre", "cheminee": "Fireplace", "climatisation": "Air conditioning",
};
const traduireNom = (nom) => NOMS[cle(nom)] || null;
const TYPES = { maison: "House", appartement: "Apartment", terrain: "Plot of land", propriete: "Property", immeuble: "Building", local: "Commercial premises",
  villa: "Villa", chateau: "Château", ferme: "Farmhouse", grange: "Barn", parking: "Parking", bureau: "Office", commerce: "Business" };
const typeEn = (t) => { const k = cle(t); const x = Object.keys(TYPES).find((m) => k.startsWith(m)); return x ? TYPES[x] : null; };

module.exports = { traduireValeur, traduireNom, typeEn };
