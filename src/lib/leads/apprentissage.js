/* Gabarits appris automatiquement — même principe que l'ancienne table gabarit_version d'AMBS.

   Un gabarit = la « forme » d'un type de mail :
     { id, source, nature, signature: { expediteur, ancres[], objet? }, champs: [{ nom, motif, flags }],
       statut, nb_observations, nb_echecs, origine }
   statut : candidat (en observation) → actif (utilisé sans IA) ; suspendu (la forme a changé) ; quarantaine (doublon).

   Boucle :
   1. un mail arrive ; si un gabarit actif reconnaît sa forme, ses motifs lisent les champs, sans IA ;
   2. sinon l'IA lit le mail et propose des motifs ;
   3. chaque motif est REJOUÉ sur le mail et doit retrouver exactement ce que l'IA a lu ;
      un motif qui contient une donnée personnelle du mail (nom, e-mail, numéro) est refusé ;
   4. les variantes d'une même forme (source + nature + signature) sont regroupées ;
   5. une variante validée 2 fois, dans une forme vue au moins 3 fois, devient active toute seule ;
      plusieurs mises en page d'un même portail peuvent être actives en même temps ;
   6. si un gabarit actif échoue 3 fois de suite (le portail a changé sa mise en page), il est suspendu :
      l'IA reprend la main et un nouveau gabarit s'apprend.

   Le stockage est fourni par l'appelant : { lister(), creer(g), maj(id, champs) }. */
"use strict";
const { cle } = require("./texte");
const { dom } = require("./portails");
const V = require("./valeurs");
const { CHAMPS_MOTIF } = require("./ia");

const SEUIL_DIRECT = 2, SEUIL_FORME = 3, SEUIL_ECHECS = 3;
const MAX_TEXTE = 30000;

const norm = (x) => String(x == null ? "" : x).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9@.+]/g, "");
const memeValeur = (champ, a, b) => {
  if (champ === "telephone") { const d = (s) => String(s || "").replace(/\D/g, "").replace(/^00/, "").slice(-9); return d(a).length >= 6 && d(a) === d(b); }
  if (champ === "message") { const k = (s) => cle(s).split(" ").slice(0, 12).join(" "); return k(a) === k(b); }
  if (/prix|surface|nb_pieces/.test(champ)) { const n = (s) => Math.round(+String(s).replace(/[^\d.,]/g, "").replace(",", ".")); return n(a) === n(b); }
  return norm(a) === norm(b);
};

const estNomComplet = (v, ia) => [ia.prenom + " " + ia.nom, ia.nom + " " + ia.prenom].some((x) => norm(x) === norm(v));

/* Motif dangereux (retour arrière catastrophique) ou qui contient une donnée du mail. */
const motifSur = (motif, valeurs = {}) => {
  if (typeof motif !== "string" || !motif.trim() || motif.length > 300) return "motif vide ou trop long";
  if (/\((?:[^()]*[+*])[^()]*\)[+*{]/.test(motif)) return "motif trop coûteux (quantificateurs imbriqués)";
  try { new RegExp(motif, "im"); } catch (e) { return "motif invalide"; }
  if (!/\((?!\?)/.test(motif)) return "aucun groupe de capture";
  const m = norm(motif.replace(/\\./g, (x) => x.slice(1)));
  for (const k of ["nom", "prenom", "email", "telephone", "reference"]) {
    const v = norm(valeurs[k]);
    if (v && v.length >= 3 && m.includes(v)) return `contient la donnée « ${k} » du mail`;
  }
  const tel = String(motif).replace(/\D/g, "");
  if (tel.length >= 6 && /\d{6,}/.test(motif)) return "contient un numéro";
  return null;
};

/* Une valeur capturée doit avoir la forme du champ. Sinon elle est refusée, à l'apprentissage comme à la lecture.
   (Erreurs vues dans les anciens gabarits d'AMBS : numéro d'assistance du portail pris pour le téléphone,
   « Bonjour » pour la ville, « contact » pour le nom, une phrase pour le type, une référence pour le code postal.) */
const MOTS_VIDES = /^(bonjour|bonsoir|hello|madame|monsieur|mme|mr|m\.?|contact|client|prospect|internaute|acqu[ée]reur|acheteur|nom|pr[ée]nom|num[ée]ro( de t[ée]l[ée]phone)?|t[ée]l[ée]phone|e-?mail|adresse|message|ville|merci|cordialement|n\.?c\.?|non communiqu[ée]|inconnu|null|undefined|-)$/i;
const valeurValide = (nom, v) => {
  const x = String(v || "").trim();
  if (!x || MOTS_VIDES.test(x)) return false;
  switch (nom) {
    case "email": return !!V.email(x) && !/(no-?reply|ne-pas-repondre|support@|contact@|info@)/i.test(x);
    case "telephone": return !!V.telephone(x) && x.replace(/\D/g, "").length <= 15;
    case "nom": case "prenom": case "nom_complet": return x.length <= 40 && !/[\d@:?!]/.test(x) && x.split(/\s+/).length <= 4 && !/(agence|immobili|s[ée]lection|portail|leboncoin|seloger)/i.test(x);
    case "ville": return x.length <= 45 && !/\d{3,}|[@?!]/.test(x) && x.split(/\s+/).length <= 5;
    case "code_postal": return /^\d{5}$/.test(x);
    case "type_bien": return x.length <= 40 && !!V.typeBien(x);
    case "prix": { const n = V.prix(x) || +x.replace(/\D/g, ""); return n >= 1000 && n < 1e8; }
    case "surface": { const n = +String(x).replace(",", ".").replace(/[^\d.]/g, ""); return n > 5 && n < 100000; }
    case "nb_pieces": case "pieces": { const n = +x.replace(/\D/g, ""); return n >= 1 && n <= 50; }
    case "reference": return x.length <= 40 && /\d/.test(x) && !/\s{2,}/.test(x);
    case "message": return x.length >= 2;
    default: return x.length <= 200;
  }
};
/* Le motif doit s'appuyer sur un libellé du mail (au moins 3 lettres écrites avant la capture) : un motif nu
   (« (\d+) », « ^(.+)$ ») prend n'importe quoi. */
const ancreSurLibelle = (motif) => { const avant = String(motif).split(/\((?!\?)/)[0].replace(/\\[sSdDwWbB]|[\^$.*+?{}\[\]|\\]/g, " "); return /[a-zà-ÿ]{3}/i.test(avant); };

const capturer = (motif, flags, texte) => {
  let m;
  try { m = new RegExp(motif, flags || "im").exec(texte); } catch (e) { return null; }
  if (!m) return null;
  const v = String(m[1] != null ? m[1] : m[0]).trim();
  return v && v.length <= 12000 ? v : null;
};

/* Clé de forme : source + nature + signature (comme templateKey d'AMBS). */
const slug = (s) => cle(s).replace(/ /g, "_") || "inconnue";
const cleForme = (g) => {
  const s = g.signature || {};
  return JSON.stringify([slug(g.source), g.nature, String(s.expediteur || "").toLowerCase(), String(s.objet || ""), [...new Set((s.ancres || []).map((a) => cle(a)))].sort()]);
};

/* Le gabarit reconnaît-il ce mail ? expéditeur, objet et toutes les ancres. */
const testRegle = (p, v) => { if (!p) return true; try { return new RegExp(p, "i").test(v); } catch (e) { return String(v).toLowerCase().includes(String(p).toLowerCase()); } };
const reconnait = (g, mail, texte) => {
  const s = g.signature || {};
  const ancres = (s.ancres || []).filter(Boolean);
  if (!s.expediteur && !ancres.length) return false;
  const exp = String(mail.expediteur || "").toLowerCase();
  if (s.expediteur && !testRegle(s.expediteur, dom(exp) || exp) && !testRegle(s.expediteur, exp)) return false;
  if (s.objet && !testRegle(s.objet, String(mail.objet || ""))) return false;
  const t = cle(texte);
  return ancres.every((a) => t.includes(cle(a)));
};
const score = (g) => { const s = g.signature || {}; return (s.ancres || []).length * 30 + (s.expediteur ? 18 : 0) + (s.objet ? 12 : 0) + Math.min((g.champs || []).length, 15) + Math.min(+g.nb_observations || 0, 20); };

/* Meilleur gabarit actif pour ce mail. */
const candidats = (gabarits, mail, texte) => gabarits.filter((g) => g.statut === "actif" && reconnait(g, mail, texte)).sort((a, b) => score(b) - score(a));
const choisir = (gabarits, mail, texte) => candidats(gabarits, mail, texte)[0] || null;

/* Applique les motifs d'un gabarit : { nom: valeur }. */
const appliquer = (g, texte) => {
  const t = String(texte).slice(0, MAX_TEXTE), out = {};
  for (const c of g.champs || []) {
    if (!c || !c.nom || !c.motif || out[c.nom]) continue;
    const v = capturer(c.motif, c.flags, t);
    if (v && valeurValide(c.nom, v)) out[c.nom] = v;
  }
  return out;
};

/* Valeurs plates (IA ou gabarit) → extraction du moteur (contact / bien / recherche). */
const versExtraction = (r, vals, preuve) => {
  const poser = (chemin, v) => {
    if (v === undefined || v === null || v === "" || (typeof v === "number" && !isFinite(v))) return;
    const [a, b] = chemin.split(".");
    const cible = r[a] || (r[a] = {});
    const faible = chemin === "contact.email" && ["expediteur", "texte"].includes(r.preuves[chemin]);
    if (cible[b] !== undefined && cible[b] !== null && cible[b] !== "" && !faible) return;
    cible[b] = v; r.preuves[chemin] = preuve;
  };
  const x = { ...vals };
  if (x.nom_complet && !x.nom && !x.prenom) x.nom = x.nom_complet;
  /* mots qui ne sont jamais une identité (défauts vus dans les anciens gabarits : « contact », « Nouveau ») */
  const GENERIQUE = /^(contact|nouveau|nouvelle|client|prospect|acquéreur|acquereur|internaute|madame|monsieur|mme|mr|m|info|noreply|no-reply|admin|sans nom|inconnu|n\.?c\.?)$/i;
  for (const k of ["nom", "prenom"]) if (x[k] && (GENERIQUE.test(String(x[k]).trim()) || /[@<>:]|https?:/.test(x[k]) || String(x[k]).length > 80)) x[k] = null;
  /* un nom deviné faiblement (nom affiché de l'expéditeur, signature) cède devant un nom lu sous un libellé */
  const c0 = r.contact || (r.contact = {});
  if ((x.nom || x.prenom) && ["expediteur", "signature"].includes(r.preuves["contact.nom_complet"])) {
    for (const k of ["nom", "prenom", "nom_complet"]) { delete c0[k]; delete r.preuves["contact." + k]; }
  }
  if (x.nom && !x.prenom && /\S\s+\S/.test(x.nom) && !(c0.nom || c0.prenom)) {
    const p = V.decouperNom(String(x.nom), "auto");
    if (p.nom && p.prenom) { if (!r.contact.nom_complet) r.contact.nom_complet = String(x.nom).trim(); x.nom = p.nom; x.prenom = p.prenom; }
  }
  poser("contact.email", V.email(x.email));
  poser("contact.telephone", x.telephone ? V.telephone(String(x.telephone)) || null : null);
  poser("contact.nom", x.nom ? V.nomPropre(String(x.nom)) : null);
  poser("contact.prenom", x.prenom ? V.nomPropre(String(x.prenom)) : null);
  if (x.message && !r.message) { r.message = String(x.message).slice(0, 8000); r.preuves.message = preuve; }
  if (x.reference) { const m = String(x.reference).match(/[\w][\w./-]*/); if (m) poser("bien.reference", m[0]); }
  poser("bien.type", x.type_bien ? V.typeBien(String(x.type_bien)) || null : null);
  poser("bien.pieces", x.nb_pieces != null ? V.nombre(String(x.nb_pieces)) : null);
  poser("bien.surface", x.surface != null ? V.surface(String(x.surface) + (/m/.test(String(x.surface)) ? "" : " m²")) : null);
  poser("bien.prix", x.prix != null ? V.prix(String(x.prix) + (/€|eur/i.test(String(x.prix)) ? "" : " €")) : null);
  poser("bien.ville", x.ville ? String(x.ville).trim() : null);
  poser("bien.code_postal", x.code_postal ? (String(x.code_postal).match(/\b\d{5}\b/) || [])[0] : null);
  poser("bien.adresse", x.adresse ? String(x.adresse).trim() : null);
  poser("recherche.type", x.recherche_type_bien ? V.typeBien(String(x.recherche_type_bien)) || String(x.recherche_type_bien) : null);
  poser("recherche.localisation", x.recherche_localisation || null);
  poser("recherche.budget_max", x.recherche_budget_max != null ? V.prix(String(x.recherche_budget_max) + " €") : null);
  poser("recherche.surface_min", x.recherche_surface_min != null ? V.nombre(String(x.recherche_surface_min)) : null);
  poser("recherche.pieces_min", x.recherche_nb_pieces_min != null ? V.nombre(String(x.recherche_nb_pieces_min)) : null);
  poser("recherche.chambres_min", x.recherche_nb_chambres_min != null ? V.nombre(String(x.recherche_nb_chambres_min)) : null);
  return r;
};

/* Un gabarit est utile s'il donne un moyen de joindre le prospect ET (son nom OU le bien). */
const complet = (presents) => {
  const has = (k) => presents.has(k);
  const bien = has("reference") || ["type_bien", "nb_pieces", "surface", "prix", "ville", "code_postal", "adresse"].filter(has).length >= 2;
  return (has("email") || has("telephone")) && (has("nom") || has("prenom") || has("nom_complet") || bien);
};

/* Rejoue un gabarit sur le mail et compare à ce que l'IA a lu. */
const evaluer = (g, texte, ia) => {
  let captures = 0, accords = 0, desaccords = 0; const presents = new Set();
  const vals = appliquer(g, texte);
  for (const [k, v] of Object.entries(vals)) {
    captures++; presents.add(k);
    if (k === "nom_complet") { if (ia.nom && ia.prenom) { if (estNomComplet(v, ia)) accords++; else desaccords++; } continue; }
    const att = ia[k];
    if (att !== null && att !== undefined && att !== "") { if (memeValeur(k, v, att)) accords++; else desaccords++; }
  }
  return { g, captures, accords, desaccords, valide: desaccords === 0 && captures > 0 && complet(presents) };
};

/* Candidat proposé par la lecture de l'IA : seuls les motifs rejoués avec succès sont gardés. */
const candidat = (ia, mail, texte) => {
  const champs = [], rejets = [];
  const t = String(texte).slice(0, MAX_TEXTE);
  for (const nom of CHAMPS_MOTIF) {
    const motif = ia["motif_" + nom];
    if (!motif) continue;
    const pb = motifSur(motif, ia);
    if (pb) { rejets.push(`${nom} : ${pb}`); continue; }
    if (!ancreSurLibelle(motif)) { rejets.push(`${nom} : motif sans libellé (prendrait n'importe quoi)`); continue; }
    const v = capturer(motif, "im", t);
    if (!v) { rejets.push(`${nom} : ne retrouve rien dans le mail`); continue; }
    if (!valeurValide(nom, v)) { rejets.push(`${nom} : « ${v.slice(0, 40)} » n'a pas la forme d'un ${nom}`); continue; }
    if ((nom === "nom" || nom === "prenom") && ia.nom && ia.prenom && estNomComplet(v, ia)) { if (!champs.some((c) => c.nom === "nom_complet")) champs.push({ nom: "nom_complet", motif, flags: "im" }); continue; }
    if (ia[nom] !== null && ia[nom] !== undefined && ia[nom] !== "" && !memeValeur(nom, v, ia[nom])) { rejets.push(`${nom} : trouve « ${v.slice(0, 40)} » au lieu de la valeur lue`); continue; }
    champs.push({ nom, motif, flags: "im" });
  }
  const ancre = ia.signature_ancre && cle(ia.signature_ancre).length >= 8 && !motifSur("(" + ia.signature_ancre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", ia) ? ia.signature_ancre.trim() : null;
  const d = dom(mail.expediteur);
  const g = {
    source: ia.source || d || "inconnue", nature: ia.nature === "reclamation" ? "lead" : ia.nature,
    signature: { expediteur: d ? d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$" : null, ancres: ancre ? [ancre] : [] },
    champs,
  };
  if (!ancre) rejets.push("signature : pas de phrase stable, la forme est reconnue par l'expéditeur seul");
  return { gabarit: g, rejets };
};

/* Apprend de la lecture de l'IA. Rend ce qui a été fait (journal). */
const apprendre = async (store, { mail, texte, ia }) => {
  if (!store || !ia || !["lead", "recherche", "estimation", "reclamation"].includes(ia.nature)) return { fait: "rien", raison: "pas un lead" };
  const { gabarit: cand, rejets } = candidat(ia, mail, texte);
  if (!cand.signature.expediteur) return { fait: "rien", raison: "expéditeur illisible", rejets };
  const tous = await store.lister();
  const k = cleForme(cand);
  const forme = tous.filter((g) => cleForme(g) === k && g.statut !== "suspendu");
  const obsForme = forme.reduce((n, g) => n + Math.max(0, +g.nb_observations || 0), 0) + 1;
  const testes = forme.map((g) => evaluer(g, texte, ia)).sort((a, b) => b.valide - a.valide || b.accords - a.accords || b.captures - a.captures || (+b.g.nb_observations || 0) - (+a.g.nb_observations || 0));
  const meilleur = testes.find((x) => x.valide);
  if (meilleur) {
    const g = meilleur.g, direct = (+g.nb_observations || 0) + 1;
    const maj = { nb_observations: direct, nb_echecs: 0, vu_le: new Date().toISOString() };
    let fait = "renforcé";
    if (g.statut !== "actif" && direct >= SEUIL_DIRECT && obsForme >= SEUIL_FORME) {
      /* les autres gabarits actifs de la même forme restent actifs : un portail peut avoir plusieurs mises en page
         en même temps ; celui qui ne sait plus rien lire est suspendu par echec() */
      maj.statut = "actif"; maj.active_le = new Date().toISOString(); fait = "activé";
    }
    await store.maj(g.id, maj);
    return { fait, id: g.id, source: g.source, observations: direct, forme: obsForme, rejets };
  }
  const ev = evaluer({ ...cand, id: null }, texte, ia);
  if (!ev.valide) return { fait: "rien", raison: "motifs insuffisants pour lire ce type de mail sans IA", rejets };
  const nouveau = await store.creer({ ...cand, statut: "candidat", nb_observations: 1, nb_echecs: 0, origine: "ia", cree_le: new Date().toISOString(), vu_le: new Date().toISOString() });
  return { fait: "créé", id: nouveau && nouveau.id, source: cand.source, observations: 1, forme: obsForme, rejets };
};

/* Un gabarit actif a reconnu le mail mais n'a pas su le lire en entier : la forme a peut-être changé. */
const echec = async (store, g) => {
  const n = (+g.nb_echecs || 0) + 1;
  const maj = { nb_echecs: n };
  if (n >= SEUIL_ECHECS) { maj.statut = "suspendu"; maj.suspendu_le = new Date().toISOString(); }
  await store.maj(g.id, maj);
  return maj.statut === "suspendu" ? "suspendu" : "échec noté";
};
const reussite = async (store, g) => { await store.maj(g.id, { nb_echecs: 0, nb_utilisations: (+g.nb_utilisations || 0) + 1, vu_le: new Date().toISOString() }); };

/* Stockage en mémoire (tests, mode sans base). */
const memoire = (depart = []) => {
  const L = depart.map((g, i) => ({ id: g.id || i + 1, ...g }));
  let n = L.reduce((m, g) => Math.max(m, +g.id || 0), 0);
  return {
    lister: async () => L.map((g) => ({ ...g })),
    creer: async (g) => { const x = { ...g, id: ++n }; L.push(x); return x; },
    maj: async (id, c) => { const g = L.find((x) => x.id === id); if (g) Object.assign(g, c); },
    tous: () => L,
  };
};

/* Import de l'ancienne table gabarit_version (AMBS) : seuls les actifs, champs relus. */
const depuisAmbs = (lignes) => lignes.filter((g) => g.statut === "actif").map((g) => {
  const p = (v) => { for (let i = 0; i < 3 && typeof v === "string"; i++) { try { v = JSON.parse(v); } catch (e) { return null; } } return v; };
  const s = p(g.signature) || {};
  return {
    source: String(g.source || "inconnue"), nature: g.nature === "reclamation" ? "lead" : g.nature,
    signature: { expediteur: s.expediteur || null, ancres: s.ancres || [], ...(s.objet ? { objet: s.objet } : {}) },
    champs: (p(g.champs) || []).filter((c) => c && c.nom && c.motif && !motifSur(c.motif)).map((c) => ({ nom: c.nom, motif: c.motif, flags: c.flags || "im" })),
    /* jamais cru sur parole : repris comme candidat, il ne lit seul qu'une fois confirmé par l'IA (voir apprendre) */
    statut: "candidat", nb_observations: 0, nb_echecs: 0, origine: "ambs:" + g.id + (g.version ? ":" + g.version : ""),
  };
});

module.exports = { valeurValide, ancreSurLibelle, choisir, candidats, appliquer, reconnait, versExtraction, apprendre, echec, reussite, candidat, evaluer, motifSur, cleForme, memoire, depuisAmbs, complet, memeValeur, SEUIL_DIRECT, SEUIL_FORME, SEUIL_ECHECS };
