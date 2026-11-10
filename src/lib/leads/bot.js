/* Bot WhatsApp des leads : ce que l'application lui donne (contexte, fiche du bien) et ce qu'elle
   fait de ses événements (écritures CRM, messages aux équipes).
   Pur : aucune table, aucun réseau. La colle avec les tables et le CRM est dans tables/bot.js.
   Règle de fond : le bot ne reçoit du bien que les champs de CHAMPS_PUBLICS, rien d'autre du CRM. */
"use strict";
const { destinataires } = require("./routage");

const CHAMPS_PUBLICS = ["type", "pieces", "chambres", "surface", "ville", "code_postal", "prix"];
/* cartes du carrousel rédigées par l'application (lib/leads/cartes.js) : seulement le titre et les lignes, par langue */
const cartesPourBot = (b) => {
  const c = b && b.cartes, out = {};
  for (const l of ["fr", "en"]) {
    const x = c && c[l], titre = x && x.titre ? { titre: x.titre } : {};
    /* un texte par photo (depuis le 16/10) ; les anciennes cartes (une ligne par photo) restent lisibles jusqu'à leur réécriture */
    if (x && Array.isArray(x.cartes) && x.cartes.length >= 2) out[l] = { ...titre, cartes: x.cartes.slice(0, 9).map((k) => ({ image: k.image, texte: k.texte })) };
    else if (x && Array.isArray(x.lignes) && x.lignes.length >= 3) out[l] = { ...titre, lignes: x.lignes.slice(0, 9) };
  }
  return Object.keys(out).length ? { cartes: out } : {};
};
/* le bien est-il encore en vente ? statut du CRM lu à l'instant : « EnCours » et diffusé → oui ; autre statut ou non diffusé → non ;
   statut inconnu → null : le bot n'affirme rien */
const enVente = (b) => {
  if (!b || b.statut == null || b.statut === "") return { en_vente: null };
  const oui = /^encours$/i.test(String(b.statut)) && b.diffuse !== false;
  return { en_vente: oui, statut_lu_le: new Date(b.fictif ? Date.now() : b.synchro_le || Date.now()).toISOString() };   // fictif : l'application est la source
};
const bienPublic = (b) => {
  const o = {};
  for (const k of CHAMPS_PUBLICS) if (b && b[k] != null && b[k] !== "") o[k] = k === "ville" ? nomVille(b[k]) : b[k];
  return Object.keys(o).length ? o : null;
};

/* Ce que le bot peut dire de l'annonce : tout ce qui est public, sauf les informations réservées au négociateur et tout montant
   autre que le prix (une phrase de la description qui cite un montant est retirée entière)
   (slide 07 du script : adresse, cadastre, vendeur, mandat, honoraires, estimation, historique, statistiques, clés,
   visites, documents) et les données internes (secteur, statut, références, géolocalisation, pièces justificatives). */
const CRITERES_EXCLUS = new Set([26, 52, 54, 57, 64, 65, 66, 121, 122, 123, 124, 131, 163, 207, 223, 1924, 1929, 1934, 1935, 2019, 2171, 2777,
  /* distances (train, aéroport, autoroute, commerces, mer, piscine, voie express) : le CRM ne donne aucune unité ; « Piscine » (273) est une distance */
  105, 106, 107, 108, 215, 273, 1881, 2335]);
const CRITERES_PRINCIPAUX = new Set([27, 28, 30, 33, 34, 38, 1861, 1933]);   // déjà dans les champs publics
const NOM_EXCLU = new RegExp([
  "mandat", "honorair", "commission", "cadastr", "adresse", "rayon", "g[ée]oloc", "secteur", "r[ée]f[ée]rence", "num[ée]ro", "\\bn°", "statut",
  "prix estim", "estimation", "net vendeur", "de d[ée]part", "propri[ée]taire", "vendeur", "\\bcl[ée]s?\\b", "visite", "notaire", "\\bdate", "mise [àa] jour",
  "justificatif", "ventes? priv", "prix au m", "^autres$",
  /* vendeur, occupation, accès, données internes, documents et juridique */
  "cause vente", "occup[ée]", "\\bbail\\b", "digicode", "^t[ée]l[ée]phone$", "accord de commercialisation", "^panneau$", "points? (forts?|faibles?)",
  "^syndic$", "nom r[ée]sidence", "ademe", "^diagnostic", "organisation diagnostic", "proc[ée]dure", "certificat", "^titre",
  /* slide 07 : « seul le prix de l'annonce est communicable » — aucun autre montant (taxe, charges, dépenses d'énergie, travaux, loyer) */
  "taxe", "charges", "d[ée]penses", "montant", "\\bco[uû]ts?\\b", "loyer", "\\bprix\\b"].join("|"), "i");   // titre : rendu à part (titre_annonce)
const PHRASE_EXCLUE = /\d[\d\s.,]*\s?(€|euros?\b|k€|eur\b)|honorair|frais d.agence|mandat|propri[ée]taire|vendeur|cadastr|\bcl[ée]s\b|adresse|\b\d+\s*,?\s*(rue|route|chemin|avenue|av\.|bd|boulevard|impasse|all[ée]e|place|lieu-dit)\b/i;
/* texte libre de l'annonce : une phrase qui contient un mail, un lien, un téléphone ou une information réservée est retirée entière */
const COORDONNEE = (x) => /[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|www\./i.test(x) || (String(x).match(/\+?\d[\d .-]{7,}\d/g) || []).some((m) => m.replace(/\D/g, "").length >= 9);
const nettoyer = (t, max = 2500) => String(t || "").split(/(?<=[.!?\n])\s+/)
  .filter((x) => x.trim() && !PHRASE_EXCLUE.test(x) && !COORDONNEE(x)).join(" ").replace(/[ \t]+/g, " ").trim().slice(0, max);
const UNITE = (nom) => (/^surface|surface (s[ée]jour|terrain|habitable)/i.test(nom) ? " m²" : /taxe|d[ée]penses|montant|charges/i.test(nom) ? " €" : "");
const annonce = (a) => {
  if (!a || typeof a !== "object") return {};
  const details = {};
  for (const c of a.criteres || []) {
    const id = +c.id, nom = String(c.nom || "").trim();
    if (!nom || CRITERES_EXCLUS.has(id) || CRITERES_PRINCIPAUX.has(id) || (id >= 2631 && id <= 2714) || NOM_EXCLU.test(nom)) continue;
    let v = c.valeur;
    if (c.nature === "case") { if (v === true || /^(true|1|oui)$/i.test(String(v))) v = "oui"; else continue; }
    else if (c.nature === "nombre") { if (!isFinite(+v) || +v === 0) continue; v = String(+(+v).toFixed(2)) + UNITE(nom); }
    else { v = nettoyer(v, 400); if (!v) continue; }
    details[nom] = v;
  }
  const par = (champ) => Object.fromEntries((a.descriptions || []).filter((d) => ["fr", "en"].includes(d.langue)).map((d) => [d.langue, nettoyer(d[champ], champ === "titre" ? 160 : 2500)]).filter(([, v]) => v));
  const pieces = (a.pieces || []).map((x) => [x.piece, x.surface ? `${x.surface} m²` : "", x.niveau, nettoyer(x.commentaire, 120)].filter(Boolean).join(" · ")).filter(Boolean).slice(0, 30);
  const out = {};
  if (Object.keys(details).length) out.details = details;
  /* prospect anglophone : les valeurs qui se traduisent entièrement (jamais de français dans une conversation anglaise) */
  const { traduireValeur } = require("./traduction");
  const en = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, traduireValeur(v)]).filter(([, v]) => v));
  if (Object.keys(en).length) out.details_en = en;
  const t = par("titre"), d = par("texte");
  if (Object.keys(t).length) out.titre_annonce = t;
  if (Object.keys(d).length) out.description_annonce = d;
  if (pieces.length) out.pieces_detail = pieces;
  return out;
};

/* Projet du lead connu avant la conversation : son mail (phase 1), puis ses recherches dans le CRM. Le bot revalide
   ces informations au lieu de les redemander. Jamais les notes internes ni les commentaires des recherches. */
const dejaConnu = (x = {}, contact = null, bien = null) => {
  const r = x.recherche || {}, projets = (contact && contact.projets) || [];
  const p = projets.find((o) => o.budget_max || o.zone || o.delai) || projets[0] || {};
  /* Sidy, 09/11 : « le leads a jamais donné de budget […] l'annonce il a cliqué […] c'est pas le budget qu'il a donné ». Le bot dit
     « vous aviez indiqué un budget » : seulement ce que le lead a écrit lui-même dans sa demande, jamais le prix de l'annonce. Les
     recherches du CRM ne donnent jamais de budget : l'application les crée à partir du bien cliqué (budget = prix, criteresProjet). */
  const prix = +(bien && bien.prix) || 0, b = +r.budget_max || 0;
  const budget = b && !(prix && Math.abs(b - prix) <= prix * 0.02) ? r.budget_max : null;
  const o = { budget, budget_min: null, zone: r.localisation || p.zone || null, rayon_km: p.rayon_km || null,
    surface_min: r.surface_min || p.surface_min || null, terrain_min: p.terrain_min || null, pieces_min: r.pieces_min || p.pieces_min || null,
    delai: p.delai || null, bien_a_vendre: p.revente != null ? p.revente : null, usage: p.usage || null, motif: p.motif || null };
  return o;
};

const tel9 = (t) => String(t || "").replace(/\D/g, "").slice(-9);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* espace simple : la police du PDF n'a pas l'espace fine de toLocaleString("fr-FR") */
const milliers = (n) => String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const majuscule = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
/* « VILLEFRANCHE-DE-ROUERGUE » (saisie du CRM) → « Villefranche-de-Rouergue » ; une ville déjà bien écrite n'est pas touchée */
const nomVille = (v) => { const s = String(v || "").trim(); return !s || s !== s.toUpperCase() ? s : majuscule(s).replace(/(?<=[\s-])(De|Du|Des|Le|La|Les|Sur|Sous|En|Et|Au|Aux|Lès|D(?=['’])|L(?=['’]))(?=[\s'’-])/g, (m) => m.toLowerCase()); };

/* Qui reçoit vraiment, avec le routage en service : négociateur ou son remplaçant, assistant(e), siège, copies. */
const quiRecoit = (negoId, conf = {}, bien, quand = new Date()) => {
  const b = bien || {}, R = conf.routage || {};
  const r = destinataires(negoId, quand, R, { prix: +b.prix || null, type: b.type || null, code_postal: b.code_postal || null, nature: "lead" });
  const nego = r.liste.find((x) => x.roles.includes("negociateur"));
  const personne = (nego && (R.personnes || []).find((p) => String(p.email || "").trim().toLowerCase() === nego.email)) || null;
  return { liste: r.liste, personne };
};

/* Réponse au bot quand une conversation commence. etat = { optout, fiche, ouverture, statut } */
const contexte = ({ dossier, lead, bien, photos = [], contact = null, conf, reglages: R = {}, etat = {}, quand }) => {
  if (!dossier) return { inconnu: true, optout: !!etat.optout };
  const x = (lead && lead.extraction) || {}, c = x.contact || {}, r = x.recherche || {};
  const { personne } = quiRecoit(dossier.negociateur || (bien && bien.negociateur_id), conf, bien, quand);
  const tel = personne ? String(personne.telephone || "").replace(/\D/g, "").replace(/^0(?=\d{9}$)/, "33") : "";
  return {
    dossier_id: dossier.id || null,
    prenom: majuscule(c.prenom || dossier.prenom || (contact && contact.prenom)),
    entite: R.entite || "",
    source: dossier.portail || "",
    negociateur: personne ? { prenom: "", nom: personne.nom } : null,
    /* photos : seulement celles du dossier d'images choisi par le client (réglage « photos »), 10 au plus (un carrousel WhatsApp) */
    /* champs publics, contenu public de l'annonce (critères, descriptions, pièces), photos du dossier d'images choisi */
    bien_public: { ...bienPublic(bien), ...annonce(bien && bien.annonce), ...(photos.length ? { photos_publiques: photos.filter((u) => /^https:\/\//.test(u)).slice(0, 10) } : {}), ...cartesPourBot(bien), ...enVente(bien) },
    /* numéro direct de la personne qui reprend : seulement si le client l'a accepté */
    liens_whatsapp: R.liens_directs === true && tel ? { negociateur: "https://wa.me/" + tel } : {},
    langue_ouverture: "fr",
    deja_connu: dejaConnu(x, contact, bien),
    /* la demande du lead telle qu'il l'a écrite au portail : le bot s'en sert pour comprendre, sans la redemander */
    demande: { message: String(x.message || "").slice(0, 1500), nature: x.nature || "", portail: dossier.portail || "" },
    ouverture_envoyee: !!etat.ouverture, fiche_annonce_envoyee: !!etat.fiche, statut: etat.statut || "", optout: !!etat.optout,
  };
};

const DEMANDES = { "OUT-1": "Demande de visite ou de rendez-vous", "OUT-2": "Demande de rappel", "OUT-3": "Projet à plus long terme, à recontacter",
  "OUT-4": "Demande à parler à un conseiller", "OUT-5": "Le prospect n'est plus intéressé", "OUT-6": "Désinscription" };
/* renvoi vers un humain sans fin de conversation (CR du 03/11) : le bot marque la sortie OUT-4 de son genre ; le titre dit ce qu'il faut reprendre */
const RENVOIS = { question: "Question du prospect à reprendre", reclamation: "Réclamation ou insatisfaction du prospect", recherche: "Recherche d'autres biens à proposer",
  vendu: "Bien plus en vente : biens proches à proposer" };
const titreSortie = (d = {}) => (d.code === "OUT-4" && RENVOIS[d.renvoi]) || DEMANDES[d.code] || "Demande";
const DELAIS = { HOT: "moins de 3 mois", WARM: "3 à 12 mois", COLD: "plus de 12 mois" };
/* Scores /100 produits par la conversation (provisoires tant que le client n'a pas validé les poids) : « bien 75/100 · financement 50/100 » */
const NOMS_SCORES = { bien: "bien", financement: "financement", travaux: "travaux", international: "relocation" };
const texteScores = (sc) => { if (!sc) return ""; const t = Object.keys(NOMS_SCORES).filter((k) => typeof sc[k] === "number").map((k) => `${NOMS_SCORES[k]} ${sc[k]}/100`).join(" · ");
  return t && sc.provisoire ? t + " (barème provisoire)" : t; };
const AVIS = { prioritaire_vendeur: "Le prospect a un bien à vendre", annulation: "Le prospect annule sa demande", message_apres_transmission: "Nouveau message du prospect après transmission",
  /* le bot ne répond plus après un STOP ; un humain décide s'il recontacte */ message_apres_stop: "Le prospect désinscrit a réécrit",
  bien_plus_en_vente: "Le prospect s'intéresse à un bien qui n'est plus en vente", visite_modifiee: "Le prospect demande un autre créneau de visite" };
/* Sidy, 22/10 : « une première notif à l'intention et une deuxième avec toutes les infos ». Intention = demande commencée ;
   la seconde = la sortie (ou la branche finie) ; arrêtée en route, le récapitulatif (recap_inacheve) part plus tard. */
const INTENTIONS = { visite: "Demande de visite en cours", rappel: "Demande de rappel en cours" };
const BRANCHES = { branche_f: ["lead_financement", "f", "Intérêt pour un accompagnement au financement", "Financement : les réponses du prospect"],
  branche_w: ["lead_travaux", "w", "Intérêt pour des travaux", "Travaux : les réponses du prospect"],
  branche_i: ["lead_relocation", "i", "Intérêt pour un accompagnement à l'installation", "Installation : les réponses du prospect"] };
const INTERNES = ["lead_financement", "lead_travaux", "lead_relocation", "tache", "score", "dossier_id", "langue", "tag", "elys_fx"];

/* réponses des branches F, W, I (clés du bot) en mots lisibles dans les mails et les actions du CRM */
const LIBELLES_BRANCHE = { paiement: "Achat", mise_en_relation: "Mise en relation avec le référent financement",   // CR du 03/11 : deux questions
  apport: "Apport", budget_global: "Budget global", accord_bancaire: "Banque ou courtier", horizon: "Horizon",
  nature: "Nature des travaux", bien_concerne: "Bien concerné", urgence: "Urgence", enveloppe: "Enveloppe", pays: "Pays", calendrier: "Calendrier",
  besoins: "Besoins", zone: "Zone", consentement: "Accord pour être contacté" };
/* Lignes « libellé, valeur » d'une sortie du bot : pour l'action du CRM et pour le message aux équipes. */
const lignes = (d = {}) => {
  const q = d.qualification || {}, etiquettes = [d.lead_prioritaire && "bien à vendre (prioritaire)", d.lead_financement && "financement", d.lead_travaux && "travaux", d.lead_relocation && "relocation"].filter(Boolean);
  const branche = (o) => Object.entries(o || {}).filter(([, v]) => v !== "" && v != null && typeof v !== "object")
    .map(([k, v]) => `${LIBELLES_BRANCHE[k] || k} : ${v === true ? "oui" : v === false ? "non" : v}`).join(" ; ");
  return [
    ["Demande", [titreSortie(d), d.motif].filter(Boolean).join(" · ")],
    ["Créneau souhaité", [d.creneau, d.fuseau].filter(Boolean).join(" · ")],
    ["Délai du projet", DELAIS[d.temperature]],
    ["Score", texteScores(d.scores)],
    ["Projet", q.projet], ["Budget", q.budget], ["Zone", q.zone], ["Financement", q.financement], ["Bien à vendre", q.bien_a_vendre],
    ["À signaler", etiquettes.join(", ")],
    ["Financement (détail)", branche(d.f)], ["Travaux (détail)", branche(d.w)], ["Relocation (détail)", branche(d.i)],
    ["Dernier message", d.dernier_message || d.texte || d.reponse],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([l, v]) => [l, String(v)]);
};

/* « Environ 250 000 € », « 250k », « 250000 » → 250000 ; rien de sûr → null */
const montant = (v) => {
  const t = String(v == null ? "" : v).toLowerCase().replace(/(\d)[\s\u00a0.](?=\d{3}\b)/g, "$1");
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(k|m|millions?)?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", ".")) * (m[2] === "k" ? 1e3 : m[2] ? 1e6 : 1);
  return n >= 10000 && n < 1e8 ? Math.round(n) : null;
};

/* Ce qu'un lot d'événements déclenche. Les identifiants de couleur et de type d'action sont ceux du CRM
   du client : R.couleurs = { HOT, WARM, COLD }, R.actions = { "OUT-1": id, …, defaut: id, VENDEUR: id }.
   R.recherches = true : à une sortie qualifiée (visite, rappel, documentation), recherche du prospect liée au bien et lien avec
   l'autre bien visité (parcours page 14). « une_fois » : écriture faite une seule fois par contact, même si le lead reprend. */
const plan = (evenements, R = {}, { vendeur: dejaVendeur = false } = {}) => {
  const out = { crm: [], avis: [], optout: false };
  const sortie = (evenements || []).some((e) => e && e.type === "sortie");
  const finies = new Set((evenements || []).filter((e) => e && BRANCHES[e.type] && e.donnees && "tache" in e.donnees).map((e) => e.type));
  /* lead vendeur = urgence (Sidy, 16/10) : rouge dans le CRM quel que soit son délai d'achat, et il le reste dans la conversation */
  const vendeur = dejaVendeur || (evenements || []).some((e) => e && (e.type === "prioritaire_vendeur" || (e.type === "sortie" && e.donnees && e.donnees.lead_prioritaire)));
  const couleurDe = (t) => (R.couleurs || {})[vendeur ? "HOT" : t];
  const poserCouleur = (couleur) => { if (couleur && !out.crm.some((x) => x.op === "couleurContact" && x.couleur === couleur)) out.crm.push({ op: "couleurContact", couleur }); };
  for (const e of evenements || []) {
    const d = (e && e.donnees) || {};
    /* vendeur : rouge et action « bien à vendre », EN PLUS du message aux équipes (branche AVIS plus bas) — bloc à part, hors de la chaîne */
    if (e.type === "prioritaire_vendeur") {
      poserCouleur(couleurDe("HOT"));
      if ((R.actions || {}).VENDEUR && !out.crm.some((x) => x.une_fois === "vendeur")) out.crm.push({ op: "ajouterAction", action_id: R.actions.VENDEUR, une_fois: "vendeur", texte: "WhatsApp. Bien à vendre déclaré par le prospect (lead prioritaire)." + (d.reponse ? `\nSa réponse : ${String(d.reponse).slice(0, 300)}` : "") });
    }
    /* visite déjà transmise, le prospect change de créneau (Sidy, 17/10) : trace dans l'historique du contact, EN PLUS du message aux équipes */
    if (e.type === "visite_modifiee" || (e.type === "annulation" && d.visite)) {   // visite annulée : même trace, le négociateur l'avait reçue
      const action = (R.actions || {})["OUT-1"] || (R.actions || {}).defaut, mot = d.texte || d.motif;
      const quoi = e.type === "annulation" ? "Visite annulée par le prospect." : `Nouveau créneau de visite demandé : ${String(d.creneau || "à préciser").slice(0, 300)}`;
      if (action) out.crm.push({ op: "ajouterAction", action_id: action, texte: `WhatsApp. ${quoi}` + (mot ? `\nSon message : ${String(mot).slice(0, 500)}` : "") });
    }
    if (e.type === "optout") out.optout = true;
    /* la couleur suit le délai dès qu'il est connu ou qu'il change, sans attendre une sortie : le lead peut s'arrêter à tout moment */
    else if (e.type === "temperature") poserCouleur(couleurDe(d.temperature));
    else if (e.type === "sortie") {
      if (d.temperature || vendeur) poserCouleur(couleurDe(d.temperature));
      const action = (R.actions || {})[d.code] || (R.actions || {}).defaut;
      if (action) out.crm.push({ op: "ajouterAction", action_id: action, texte: "WhatsApp. " + lignes(d).map(([l, v]) => `${l} : ${v}`).join("\n") });
      if (R.recherches === true && ["OUT-1", "OUT-2", "OUT-3"].includes(d.code)) {
        if (d.autre_bien_id) out.crm.push({ op: "lierBien", bien_id: String(d.autre_bien_id), une_fois: `lien-${d.autre_bien_id}` });
        const q = d.qualification || {}, criteres = {};
        if (montant(q.budget)) criteres.budget_max = montant(q.budget);
        if (q.zone) criteres.localisation = String(q.zone).slice(0, 80);
        if (!out.crm.some((x) => x.op === "creerRecherche")) out.crm.push({ op: "creerRecherche", une_fois: "recherche", criteres });
      }
      if (d.code !== "OUT-6") out.avis.push({ titre: titreSortie(d), qualifie: d.code !== "OUT-5" && !RENVOIS[d.renvoi], prioritaire: !!d.lead_prioritaire, donnees: d, referents: [d.lead_financement && "f", d.lead_travaux && "w", d.lead_relocation && "i"].filter(Boolean) });
    } else if (AVIS[e.type] && !(sortie && e.type === "prioritaire_vendeur"))
      out.avis.push({ titre: AVIS[e.type], type: e.type, prioritaire: e.type === "prioritaire_vendeur", donnees: d, referents: [] });
    /* la sortie du même tour porte déjà tout : ni l'intention ni le détail d'une branche ne partent à part */
    else if (e.type === "intention" && INTENTIONS[d.demande] && !sortie)
      out.avis.push({ titre: INTENTIONS[d.demande], type: e.type, suite: true, donnees: d, referents: [] });
    else if (BRANCHES[e.type] && d[BRANCHES[e.type][0]] === true && !sortie) {
      const [, k, debut, fin] = BRANCHES[e.type], finie = "tache" in d;
      if (finie) out.avis.push({ titre: fin, type: e.type, donnees: { [k]: Object.fromEntries(Object.entries(d).filter(([c]) => !INTERNES.includes(c))) }, referents: [k] });
      else if (!finies.has(e.type)) out.avis.push({ titre: debut, type: e.type, suite: true, donnees: d, referents: [k] });
    } else if (e.type === "recap_inacheve")
      out.avis.push({ titre: "Demande inachevée, le prospect ne répond plus : " + (d.demandes || []).join(", "), type: e.type, prioritaire: (d.demandes || []).includes("bien à vendre"),
        donnees: d, referents: (d.referents || []).filter((k) => ["f", "w", "i"].includes(k)) });
  }
  return out;
};

/* Alerte WhatsApp au négociateur (modèle sh_alerte_nego ; slides 02, 08, 16, 17, R05) : visite demandée ou bien à vendre déclaré.
   Rend les 5 valeurs du modèle, ou null si l'événement n'appelle pas d'alerte (un rappel ou une documentation : le mail suffit). */
const PROJET = { HOT: "projet à moins de 3 mois", WARM: "projet entre 3 et 12 mois", COLD: "projet à plus de 12 mois" };
const alerteNego = ({ avis, dossier = {}, bien, telephone }) => {
  const d = avis.donnees || {}, visite = avis.qualifie && d.code === "OUT-1", vendeur = avis.type === "prioritaire_vendeur", modif = avis.type === "visite_modifiee", annule = avis.type === "annulation" && !!d.visite;
  /* 22/10 : visite commencée (« en cours »), puis demande arrêtée en route (« inachevé ») : visite ou bien à vendre */
  const enCours = avis.type === "intention" && d.demande === "visite";
  const inacheve = avis.type === "recap_inacheve" && (d.demandes || []).filter((x) => x === "visite" || x === "bien à vendre");
  if (!visite && !vendeur && !modif && !annule && !enCours && !(inacheve && inacheve.length)) return null;
  const b = bien || {}, t = String(telephone || "").replace(/\D/g, "");
  const demande = enCours ? ["visite en cours de préparation"] : inacheve ? [...inacheve, "le prospect ne répond plus"]
    : vendeur ? ["bien à vendre déclaré"] : annule ? ["visite annulée"] : modif ? ["nouveau créneau de visite : " + String(d.creneau || "à préciser").replace(/\s+/g, " ").trim().slice(0, 60)]
    : ["visite", d.lead_prioritaire && "bien à vendre", PROJET[d.temperature]];   // « Demande : visite, projet à moins de 3 mois »
  return [enCours ? "en cours" : inacheve ? "inachevé" : vendeur || d.lead_prioritaire ? "prioritaire" : "qualifié", String(dossier.nom || "Un prospect").slice(0, 60),
    [b.reference && "réf. " + b.reference, b.ville && "à " + b.ville].filter(Boolean).join(" ") || "de l'annonce", demande.filter(Boolean).join(", "),
    /^33\d{9}$/.test(t) ? "+33 " + t.slice(2).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5") : "+" + t];
};

/* Message aux équipes. fil = [{ role: "prospect" | "bot", texte }] ; aurait_recu : adresses réelles, rappelées pendant les essais.
   Une sortie de conversation donne le « lead qualifié » : objet distinct du mail d'arrivée du lead, synthèse, score et échange,
   pour agir sans ouvrir le système. */
const mailEquipe = ({ avis, dossier = {}, bien, bien_initial = null, telephone, fil = [], aurait_recu }) => {
  const b = bien || {}, nom = dossier.nom || "Prospect";
  const objet = `${aurait_recu ? "[ESSAI] " : ""}${avis.prioritaire ? "[PRIORITAIRE] " : ""}${avis.qualifie ? "Lead qualifié WhatsApp" : "WhatsApp"} · ${avis.titre}${b.reference ? " · réf. " + b.reference : ""} · ${nom}`;
  const ligne = (l, v) => (v ? `<tr><td style="color:#667;padding:2px 12px 2px 0;vertical-align:top">${esc(l)}</td><td><b>${esc(v)}</b></td></tr>` : "");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<p>${avis.qualifie ? "Lead qualifié à l'issue de la conversation avec l'assistant WhatsApp : " : ""}<b>${esc(avis.titre)}</b>${avis.qualifie ? "." : ", reçu par l'assistant WhatsApp."}</p>
${avis.suite ? "<p>Le prospect est en train de préciser sa demande avec l'assistant : le détail suivra dans un second message.</p>" : ""}
<table style="border-collapse:collapse">${ligne("Prospect", nom)}${ligne("Téléphone", telephone ? "+" + telephone : "")}${ligne("E-mail", dossier.email)}
${ligne(bien_initial ? "Bien demandé" : "Bien", [b.reference && "réf. " + b.reference, b.type, b.ville, b.prix && milliers(b.prix) + " €"].filter(Boolean).join(" · "))}
${bien_initial ? ligne("Bien de l'annonce d'origine", [bien_initial.reference && "réf. " + bien_initial.reference, bien_initial.type, bien_initial.ville, bien_initial.prix && milliers(bien_initial.prix) + " €"].filter(Boolean).join(" · ")) : ""}
${lignes(avis.donnees).map(([l, v]) => ligne(l, v)).join("")}</table>
${fil.length ? `<p style="margin:14px 0 4px;color:#667">L'échange</p><div style="padding:10px;background:#f3f4f6;border-radius:6px">${fil.map((m) => `<p style="margin:0 0 6px;white-space:pre-wrap"><b>${m.role === "prospect" ? "Prospect" : "Assistant"} :</b> ${esc(String(m.texte || "").slice(0, 1500))}</p>`).join("")}</div>` : ""}
${aurait_recu ? `<p style="color:#b45309;font-size:12px">Essai : en service, ce message irait à ${esc(aurait_recu.join(", ") || "personne")}.</p>` : ""}</div>`;
  return { objet: objet.slice(0, 300), html };
};

/* Fiche du bien en PDF, dans la langue du lead (R09) : même mise en page que la fiche commerciale Immofacile que les assistantes
   de SH envoient aux clients (demande de SH, 06/11/2026), SANS logo (Sidy, 09/11 : le lead a pu répondre à une annonce de l'une ou
   l'autre enseigne). Photo principale, titre, lieu, prix, contact ; description ; caractéristiques par rubrique ; DPE et GES ; photos.
   Contenu : les seuls champs publics et le contenu public de l'annonce (annonce()), jamais les informations réservées (slide 07) ni
   la référence interne du bien (le modèle des assistantes montre le n° de mandat : à ajouter seulement si Sidy le décide).
   photos : adresses des photos autorisées DÉJÀ téléchargées par l'appelant (une photo absente n'apparaît pas, jamais d'erreur imprimée).
   contact : { nom } de la personne qui s'occupe de la demande ; standard : numéro du standard. */
const MARINE = "#23395b", OR = "#b8975a";
const RUBRIQUES = [["loc", /vue|exposition|[ée]tages?|niveau|environnement|proximit|situation|quartier/i], ["surf", /^surface|surface /i],
  ["terrain", /terrain|jardin|parc|cl[oô]tur|arbor|potager|verger|am[ée]nagement ext/i],
  ["int", /chambre|salle|cuisine|chauffage|chemin[ée]e|insert|s[ée]jour|salon|\bwc\b|cave|grenier|comble|buanderie|dressing|meubl|[ée]quip|pi[eè]ce|bureau|mezzanine|cellier/i],
  ["ext", /construction|ann[ée]e|toiture|fen[êe]tre|menuiser|vitrage|isolation|fa[çc]ade|mitoyen|terrasse|balcon|piscine|garage|stationnement|parking|d[ée]pendance|grange|hangar|abri|assainissement/i]];
const NOMS_RUBRIQUES = { fr: { loc: "Localisation", surf: "Surfaces", int: "Intérieur", ext: "Extérieur", terrain: "Terrain", autres: "Autres", fin: "Aspects financiers" },
  en: { loc: "Location", surf: "Areas", int: "Interior", ext: "Exterior", terrain: "Grounds", autres: "Other", fin: "Financial" } };
const blocsFiche = (bien, quand = new Date(), langue = "fr", photos = [], contact = {}, standard = "") => {
  const b = bienPublic(bien);
  if (!b || !(b.type || b.ville)) return null;
  const en = langue === "en", T = require("./traduction"), an = annonce(bien && bien.annonce), N = NOMS_RUBRIQUES[en ? "en" : "fr"];
  const typeAff = en ? (T.typeEn(b.type) || "Property") : majuscule(b.type) || "Bien";
  const prix = b.prix && (en ? `€${String(b.prix).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : `${milliers(b.prix)} €`);
  const dans = (o) => (o && (o[en ? "en" : "fr"] || (!en && o.en) || "")) || "";
  const SIGNE = /agence|hamilton|s[ée]lection (habitat|ocean|med|immobilier|senegal|groupe)|groupe s[ée]lection|arieg.?immo|toit ?2 ?r[êe]ve|bliss|van den berg|we also speak|we spreken|wir sprechen/i;
  const titreAnnonce = dans(an.titre_annonce);
  const titre = (titreAnnonce && !SIGNE.test(titreAnnonce) ? titreAnnonce : "") || (en ? [typeAff, b.pieces && `${b.pieces} rooms`, b.ville].filter(Boolean).join(", ") : [typeAff, b.pieces && `${b.pieces} pièces`, b.ville && `à ${b.ville}`].filter(Boolean).join(" "));
  /* jamais un nom d'agence ni d'enseigne sur un document (règle du 13/10, et Sidy 09/11 : on ne sait pas sous quelle enseigne le lead a vu
     l'annonce) : une phrase de la description qui signe l'annonce est retirée entière (24 descriptions sur 99 en ont une, mesuré le 09/11) */
  const description = String(dans(an.description_annonce)).split(/(?<=[.!?\n])\s+/).filter((x) => !SIGNE.test(x)).join(" ").replace(/\s+/g, " ").trim().slice(0, 3500);
  const ph = (photos || []).filter((u) => /^https:\/\//.test(u)).slice(0, 13);
  const jour = quand.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  /* caractéristiques : champs principaux, puis celles de l'annonce rangées par rubrique (en anglais, seulement celles qui se traduisent) */
  const r = { loc: [[en ? "Country" : "Pays", "France"], ...(b.code_postal ? [[en ? "Postcode" : "Code postal", String(b.code_postal)]] : []), ...(b.ville ? [[en ? "Town" : "Ville", b.ville]] : [])],
    surf: b.surface ? [[en ? "Living area" : "Surface habitable", `${b.surface} m²`]] : [], terrain: [], ext: [], autres: [],
    int: [...(b.pieces ? [[en ? "Rooms" : "Pièces", String(b.pieces)]] : []), ...(b.chambres ? [[en ? "Bedrooms" : "Chambres", String(b.chambres)]] : [])],
    fin: prix ? [[en ? "Price" : "Prix", prix]] : [] };
  const details = en ? Object.entries(an.details_en || {}).map(([k, v]) => [T.traduireNom(k), v, k]).filter(([k]) => k) : Object.entries(an.details || {}).map(([k, v]) => [k, v, k]);
  let dpe = "", ges = "", dpeVal = "", gesVal = "";
  for (const [nom, v, brut] of details) {
    const lettre = /^[A-G]$/i.test(String(v).trim()) ? String(v).trim().toUpperCase() : "";
    if (/^valeur consommation .nergie/i.test(brut)) { dpeVal = String(v); continue; }
    if (/^valeur gaz effet de serre/i.test(brut)) { gesVal = String(v); continue; }
    if (/consommation .nergie/i.test(brut)) { dpe = lettre; continue; }
    if (/gaz effet de serre/i.test(brut)) { ges = lettre; continue; }
    if (/^(pays|country)$|trajet|distance|affichage du dpe/i.test(brut)) continue;   // déjà dit, ou sans unité
    const k = (RUBRIQUES.find(([, re]) => re.test(brut)) || ["autres"])[0];
    const val = String(v).replace(/^[-–\s]+/, "").replace(/(\d)\.(\d)/g, en ? "$1.$2" : "$1,$2").replace(/^./, (c) => c.toUpperCase());
    if (r[k].length < 12) r[k].push([nom, val]);
  }
  /* pièces de l'annonce : « Séjour · 27 m² · Rez-de-chaussée » → libellé, puis le reste (en français seulement : pas de traduction) */
  const pieces = en ? [] : (an.pieces_detail || []).slice(0, 25).map((x) => { const [a, ...b] = String(x).split(" · "); return [a, b.join(" · ").replace(/(\d)\.(\d)/g, "$1,$2") || "—"]; });
  const cles = [...["loc", "surf", "int", "ext", "terrain", "autres", "fin"].map((k) => [N[k], r[k]]), ["Pièces", pieces]].filter(([, l]) => l.length);
  const out = [
    ...(ph[0] ? [{ image: ph[0], hauteur: 330 }] : []),
    { centre: titre, taille: 14, gras: true, majuscules: true, couleur: MARINE, espace: 6 },
    ...(b.ville ? [{ centre: (en ? "Location: " : "Localisation : ") + [b.ville, b.code_postal && `(${b.code_postal})`].filter(Boolean).join(" "), taille: 10, majuscules: true, couleur: "#374151" }] : []),
    ...(prix ? [{ centre: prix, taille: 22, gras: true, couleur: MARINE, espace: 12 }] : []),
    { centre: en ? "Contact" : "Contact", taille: 8.5, gras: true, majuscules: true, couleur: OR, espace: 2 },
    ...(contact && contact.nom ? [{ centre: contact.nom, taille: 10, majuscules: true, couleur: "#374151", espace: 2 }] : []),
    ...(standard ? [{ centre: (en ? "Switchboard: " : "Standard : ") + standard + (en ? " (9am to 7pm)" : " (9h à 19h)"), taille: 9, couleur: "#374151" }] : []),
    { petit: en ? `Listing information as of ${jour}. Not a contractual document.` : `Informations de l'annonce au ${jour}. Document non contractuel.` },
  ];
  if (description) out.push({ saut: true }, { bandeau: "Description", couleur: MARINE }, { texte: description, taille: 10.5 });
  out.push({ saut: true }, { bandeau: en ? "Features" : "Caractéristiques", couleur: MARINE }, { cles, couleur: MARINE, couleur_rubrique: OR });
  if (/^[A-G]$/.test(dpe) || /^[A-G]$/.test(ges)) out.push({ bandeau: en ? "Energy performance" : "Diagnostics", couleur: MARINE, garder: 150 },
    { dpe: { dpe, ges, dpe_titre: en ? "Energy performance (DPE)" : "Consommation énergétique (DPE)", ges_titre: en ? "Greenhouse gas emissions (GES)" : "Émissions de gaz à effet de serre (GES)",
      dpe_valeur: dpeVal && `${dpeVal} kWh/m²/${en ? "year" : "an"}`, ges_valeur: gesVal && `${gesVal} kg CO2/m²/${en ? "year" : "an"}` } });
  if (ph.length > 1) out.push({ saut: true }, { bandeau: en ? "Property photos" : "Photos du bien", couleur: MARINE }, { grille: ph.slice(1), hauteur: 165 });
  return out;
};

module.exports = { RENVOIS, CHAMPS_PUBLICS, cartesPourBot, enVente, bienPublic, annonce, dejaConnu, nettoyer, tel9, quiRecoit, contexte, plan, lignes, texteScores, mailEquipe, alerteNego, blocsFiche, majuscule, nomVille };
