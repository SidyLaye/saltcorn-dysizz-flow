/* Lecteur de « fiche » : la plupart des mails de portails sont des listes
   « Libellé : valeur » (sur une ligne, ou libellé puis valeur à la ligne).
   Un seul dictionnaire de libellés (FR / EN / NL / ES) sert à tous les portails. */
"use strict";
const { cle } = require("./texte");

const LIBELLES = {
  email: ["email", "e mail", "mail", "adresse e mail", "adresse email", "email address", "courriel", "mail", "e mail de contact", "votre email"],
  telephone: ["telephone", "tel", "tel portable", "tel perso", "tel prof", "telephone portable", "phone", "phone number", "numero de telephone", "n de telephone", "numero de tel", "portable", "mobile", "telefoon", "telefono", "numero"],
  nom: ["nom", "last name", "surname", "achternaam", "nom de famille"],
  prenom: ["prenom", "first name", "voornaam", "given name"],
  nom_complet: ["nom prenom", "nom complet", "full name", "name", "naam", "customer", "client", "contact", "prospect", "nombre"],
  civilite: ["civilite", "title", "salutation"],
  message: ["message", "son message", "voici son message", "comments", "comment", "commentaire", "message du client", "customer message", "votre message", "bericht", "mensaje", "remarques", "demande", "informations complementaires souhaitees par l internaute"],
  reference: ["reference", "ref", "reference de l annonce", "ref de l annonce", "votre reference", "ref pro", "reference annonce", "reference du bien", "listing reference", "property reference", "referentie", "referencia", "mandat"],
  id_crm: ["id de ton crm", "id crm", "crm id"],
  prix: ["prix", "price", "prijs", "precio", "prix de vente"],
  ville: ["localite", "ville", "city", "town", "commune", "plaats"],
  code_postal: ["code postal", "postcode", "postal code", "zip", "cp"],
  adresse: ["adresse", "address", "adres"],
  pays: ["pays", "country", "land"],
  langue: ["langue", "language"],
  type: ["type", "type de bien", "property type"],
  surface: ["surface", "surface habitable", "living area"],
  pieces: ["pieces", "nombre de pieces", "rooms"],
  chambres: ["chambres", "bedrooms", "nombre de chambres"],
  delai: ["delai du projet", "purchase timescale", "timescale", "delai"],
  r_type: ["types de biens", "type de bien recherche", "type de projet"],
  r_localisation: ["localisation", "zone souhaitee", "secteur recherche", "location"],
  r_budget: ["budget max", "budget", "budget maximum"],
  r_surface: ["surface habitable min", "surface min"],
  r_terrain: ["surface terrain min"],
  r_pieces: ["nombre de pieces min", "pieces min"],
  r_chambres: ["nombre de chambres min", "chambres min"],
  transaction: ["transaction"],
};

const INDEX = new Map();
for (const [champ, l] of Object.entries(LIBELLES)) for (const x of l) INDEX.set(x, champ);

/* Libellés sûrs pour découper une ligne qui contient plusieurs « Libellé : valeur ». */
const INLINE = /(?<!code|n°|num[ée]ro)\s(?=(?:client|customer|email|e-mail|t[ée]l[ée]phone|phone|nego|n[ée]go|pour l'agence|for the real estate|message du client|customer message)\s*:)/gi;

const nettoyerLigne = (l) => String(l).replace(/^[\s•*·#>|-]+/, "").replace(/[\s*|]+$/, "").replace(/^\*(.+?)\*\s*:/, "$1:").trim();

const libelle = (brut) => {
  const k = cle(brut.replace(/\(s\)/g, "")).replace(/\s+(min|max)$/, (m) => m);
  if (k.length > 40) return null;
  return INDEX.get(k) || null;
};

/* Découpe en couples ordonnés { champ, valeur, ligne }. */
const lireFiche = (texte) => {
  const L = String(texte).split("\n").flatMap((l) => l.split(INLINE)).map(nettoyerLigne).filter(Boolean);
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    let m = l.match(/^([^:：]{1,45}?)\s*[:：]\s*(.*)$/);
    let champ = m && libelle(m[1]);
    let val = m ? m[2].trim() : "";
    if (!champ) { champ = libelle(l.replace(/[:：]\s*$/, "")); val = ""; m = champ ? [l] : null; }
    if (!champ) continue;
    if (!val && i + 1 < L.length) {
      const n = L[i + 1];
      const nm = n.match(/^([^:：]{1,45}?)\s*[:：]/);
      if (!libelle(n.replace(/[:：]\s*$/, "")) && !(nm && libelle(nm[1]))) { val = n; i++; }
    }
    out.push({ champ, valeur: val.replace(/^\*+\s*|\s*\*+$/g, "").trim(), ligne: i, lignes: L });
  }
  return { couples: out, lignes: L };
};

/* Bloc multiligne à partir d'une ligne, jusqu'au prochain libellé connu ou une phrase d'arrêt. */
const ARRETS = /^(répondre|reply|repondre|conseil|retrouvez|cordialement,?$|à très bientôt|a bientot|l'équipe|the .* team|nouveau\s*:|please respond|to view more|----|====|===|# |voir l|consultez|merci de votre confiance|you can reply|vous pouvez répondre|ce message|this email|traduit de|appeler|call|messages précédents|conversation history|rappel de l|annonce concernée|properties$|biens? )/i;
const bloc = (L, debut, premier = "") => {
  const out = premier ? [premier] : [];
  for (let i = debut; i < L.length && out.length < 60; i++) {
    const l = L[i];
    const m = l.match(/^([^:：]{1,45}?)\s*[:：]/);
    if ((m && libelle(m[1])) || libelle(l.replace(/[:：]\s*$/, "")) || ARRETS.test(l)) break;
    out.push(l);
  }
  return out.join("\n").replace(/^[«"*\s]+|[»"*\s]+$/g, "").trim();
};

module.exports = { LIBELLES, lireFiche, bloc, libelle, nettoyerLigne };
