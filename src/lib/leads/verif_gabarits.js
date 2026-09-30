/* Vérification des gabarits d'un ancien système, gabarit par gabarit, sur les vrais mails reçus.

   Pour chaque gabarit actif de l'ancien système :
   1. on cherche les mails qu'il reconnaît (sa signature : expéditeur, objet, phrases fixes) ;
   2. on applique chacun de ses motifs, champ par champ ;
   3. on compare avec une lecture de référence du même mail :
      - les règles du moteur quand elles lisent le mail en entier (vérifiées sur plus de 8 000 mails),
      - sinon l'IA, sur un nombre limité de mails ;
   4. on contrôle aussi la valeur elle-même : e-mail valide et hors agence, téléphone valide, nom qui n'est ni
      un rôle (« l'acheteur ») ni un mot vide, référence non vide.
   Un champ est fiable s'il a été lu juste au moins 3 fois, sans aucune erreur. Un champ qui s'est trompé une
   seule fois est retiré du gabarit ; un champ qu'on ne peut pas vérifier aussi (sauf le message du prospect).
   Le gabarit est gardé s'il lui reste de quoi joindre le prospect et son nom ou le bien ; sinon il est retiré.
   Les mails que ni les règles ni les anciens gabarits ne savent lire sont lus par l'IA, qui apprend de nouveaux
   gabarits (chaque motif est rejoué et doit retrouver exactement la lecture de l'IA).

   Le rapport ne contient aucune donnée personnelle : des nombres, des noms de champs et des verdicts. */
"use strict";
const A = require("./apprentissage");
const V = require("./valeurs");
const { extraire, nettoyerNoms } = require("./extraire");
const { aCompleter } = require("./lecture");
const { texteMail, cle } = require("./texte");

const FIABLE = 3;
const LEADS = ["lead", "relance", "recherche", "estimation", "direct"];
const DEFINITIVES = ["non_lead", "auto_reponse", "interne", "alerte_spam", "notification", "b2b", "masse", "desabonnement", "test"];
/* champ du gabarit → valeur comparée */
const COMPARES = { email: "email", telephone: "telephone", nom: "nom", prenom: "prenom", nom_complet: "identite", reference: "reference",
  prix: "prix", surface: "surface", nb_pieces: "pieces", ville: "ville", code_postal: "code_postal", type_bien: "type" };
const GARDES_SANS_VERIF = ["message"];

const mots = (...v) => [...new Set(v.flatMap((x) => cle(String(x || "")).split(/[^a-z]+/).filter((w) => w.length > 1)))].sort();
const plat = (ext) => {
  const c = ext.contact || {}, b = ext.bien || {};
  return {
    email: (V.email(c.email) || "").toLowerCase(), telephone: String(c.telephone || "").replace(/\D/g, "").slice(-9),
    nom: mots(c.nom), prenom: mots(c.prenom), identite: c.nom || c.prenom ? mots(c.prenom, c.nom) : mots(c.nom_complet),
    reference: String(b.reference || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    prix: +b.prix ? Math.round(+b.prix) : null, surface: +b.surface ? Math.round(+b.surface) : null, pieces: +b.pieces || null,
    ville: cle(String(b.ville || "")).replace(/[^a-z]/g, ""), code_postal: String(b.code_postal || ""), type: b.type || "",
  };
};
const vide = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
const egal = (k, a, b) => {
  if (["nom", "prenom", "identite"].includes(k)) { const inter = a.filter((w) => b.includes(w)).length; return inter > 0 && inter === Math.min(a.length, b.length); }
  if (["prix", "surface"].includes(k)) return Math.abs(a - b) <= Math.max(1, b * 0.005);
  return a === b;
};
const blanc = () => ({ contact: {}, bien: {}, recherche: {}, preuves: {} });
/* lecture d'un seul champ du gabarit, passée par les mêmes nettoyages que le moteur */
const lireChamp = (c, texte) => {
  const brut = A.appliquer({ champs: [c] }, texte)[c.nom];
  if (brut === undefined) return { brut: null };
  const e = A.versExtraction(blanc(), { [c.nom]: brut }, "gabarit");
  nettoyerNoms(e.contact);
  return { brut, v: plat(e) };
};
/* la valeur lue est-elle plausible, sans rien comparer ? */
const invalide = (c, lu, domaines) => {
  const k = COMPARES[c.nom];
  if (!k) return null;
  const v = lu.v[k];
  if (c.nom === "email") { if (!v) return "pas un e-mail"; const d = v.split("@")[1]; if (domaines.some((x) => d === x || d.endsWith("." + x))) return "adresse de l'agence"; }
  if (c.nom === "telephone" && !v) return "pas un numéro de téléphone";
  if (["nom", "prenom", "nom_complet"].includes(c.nom) && vide(v)) return "pas un nom (rôle, mot vide ou libellé)";
  if (c.nom === "reference" && String(v).length < 2) return "référence vide";
  return null;
};
const memeSource = (g, r) => {
  const s = cle(String(g.source || "")).replace(/[^a-z0-9]/g, "");
  if (!s || /^(email|inconnue?|autre)$/.test(s)) return null;
  const p = cle(String(r.portail || "")).replace(/[^a-z0-9]/g, ""), n = cle(String(r.portail_nom || "")).replace(/[^a-z0-9]/g, "");
  if (!p || p === "inconnu") return null;
  return [p, n].filter((x) => x && x.length >= 3).some((x) => s.includes(x) || x.includes(s));
};

/* lignes : table de l'ancien système (gabarit_version) ; mails : [{ id, expediteur, destinataire, objet, texte, html, date }] */
const verifier = async ({ lignes, mails, conf = {}, ia = null, iaMax = 150, parGabarit = 40, progres = null, apprendre = true }) => {
  const P = progres || {};
  const { borne } = require("../arriere_plan");
  const domaines = (conf.domaines_agence || []).map((d) => String(d).toLowerCase());
  const actifs = (lignes || []).filter((l) => l.statut === "actif");
  const G = actifs.map((l) => {
    const g = A.depuisAmbs([l])[0];
    let brutes = []; try { brutes = typeof l.champs === "string" ? JSON.parse(l.champs) : l.champs || []; if (typeof brutes === "string") brutes = JSON.parse(brutes); } catch (e) { brutes = []; }
    return { l, g: { ...g, statut: "actif" }, refuses: Math.max(0, (Array.isArray(brutes) ? brutes.length : 0) - g.champs.length), mails: [] };
  });
  /* 1. les mails de chaque gabarit, et la lecture des règles (du plus récent au plus ancien) */
  P.etape = "lecture des mails par les règles"; P.total = mails.length; P.fait = 0;
  const L = new Map();
  const ordre = mails.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (+b.id || 0) - (+a.id || 0));
  const sansGabarit = [];
  for (const m0 of ordre) {
    P.fait++;
    let r; try { r = extraire(m0, conf); } catch (e) { continue; }
    const m = r.mail_deballe ? { ...m0, ...r.mail_deballe, html: "" } : m0;
    const texte = texteMail({ texte: m.texte, html: m.html });
    const x = { m, texte, r, complet: LEADS.includes(r.nature) && !aCompleter(r), ref: null };
    let vu = false;
    for (const e of G) if (A.reconnait(e.g, m, texte)) { vu = true; if (e.mails.length < parGabarit) { e.mails.push(m0.id); L.set(m0.id, x); } }
    if (!vu && aCompleter(r) && !DEFINITIVES.includes(r.nature)) sansGabarit.push(x);
  }
  /* 2. lecture de référence : les règles si elles lisent tout, sinon l'IA (réparti entre gabarits, 3 chacun d'abord) */
  const IA = { appels: 0, erreurs: 0, verification: 0, apprentissage: 0 };
  const lireIA = async (x) => {
    if (!ia || IA.appels >= iaMax) return null;
    IA.appels++;
    try { const lu = await borne(ia.lire(x.m, x.texte), 90000, "IA"); return lu && lu.sortie; } catch (e) { IA.erreurs++; return null; }
  };
  for (const x of L.values()) if (x.complet) { x.ref = plat(x.r); x.refPar = "regles"; }
  P.etape = "lecture de référence par l'IA"; P.total = Math.min(iaMax, G.length * FIABLE); P.fait = 0;
  for (let tour = 0; tour < 10 && IA.appels < iaMax; tour++) {
    let fait = false;
    for (const e of G) {
      const avecRef = e.mails.filter((id) => L.get(id).ref).length;
      if (avecRef >= FIABLE + tour) continue;
      const id = e.mails.find((i) => !L.get(i).ref && !L.get(i).iaEssaye);
      if (!id) continue;
      const x = L.get(id); x.iaEssaye = true;
      const s = await lireIA(x); P.fait++; fait = true;
      if (s && ["lead", "reclamation", "recherche", "estimation"].includes(s.nature)) { const e2 = A.versExtraction(blanc(), s, "ia"); nettoyerNoms(e2.contact); x.ref = plat(e2); x.refPar = "ia"; IA.verification++; }
      if (IA.appels >= iaMax) break;
    }
    if (!fait) break;
  }
  /* 3. chaque champ de chaque gabarit contre la référence */
  const rapport = [];
  const gardes = [];
  for (const e of G) {
    const champs = {};
    let autreSource = 0, pasLead = 0, utiles = 0, refs = { regles: 0, ia: 0 };
    for (const id of e.mails) {
      const x = L.get(id);
      if (memeSource(e.g, x.r) === false) autreSource++;
      if (DEFINITIVES.includes(x.r.nature)) pasLead++;
      if (!x.complet) utiles++;
      if (x.ref) refs[x.refPar]++;
      for (const c of e.g.champs) {
        const T = champs[c.nom] || (champs[c.nom] = { accord: 0, desaccord: 0, invalide: 0, non_lu: 0, sans_reference: 0, raisons: {} });
        const lu = lireChamp(c, x.texte);
        if (lu.brut === null) { T.non_lu++; continue; }
        const pb = invalide(c, lu, domaines);
        if (pb) { T.invalide++; T.raisons[pb] = (T.raisons[pb] || 0) + 1; continue; }
        const k = COMPARES[c.nom];
        if (!k) continue;
        if (!x.ref || vide(x.ref[k])) { T.sans_reference++; continue; }
        if (egal(k, lu.v[k], x.ref[k])) T.accord++; else { T.desaccord++; T.raisons["différent de la lecture de référence (" + x.refPar + ")"] = (T.raisons["différent de la lecture de référence (" + x.refPar + ")"] || 0) + 1; }
      }
    }
    const statutChamp = (nom, T) => (GARDES_SANS_VERIF.includes(nom) ? "gardé (message)" : T.desaccord || T.invalide ? "faux : retiré" : !COMPARES[nom] ? "invérifiable : retiré" : T.accord >= FIABLE ? "fiable" : "pas assez vérifié : retiré");
    for (const [nom, T] of Object.entries(champs)) T.statut = statutChamp(nom, T);
    const gardesChamps = e.g.champs.filter((c) => champs[c.nom] && /^(fiable|gardé)/.test(champs[c.nom].statut));
    const noms = new Set(gardesChamps.map((c) => c.nom));
    const n = e.mails.length;
    let verdict, raison = null;
    if (!n) { verdict = "retiré"; raison = "ne reconnaît aucun des mails reçus"; }
    else if (autreSource > n * 0.3) { verdict = "retiré"; raison = `reconnaît des mails d'un autre portail (${autreSource} sur ${n})`; }
    else if (e.g.nature === "lead" && pasLead > n * 0.3) { verdict = "retiré"; raison = `reconnaît des mails qui ne sont pas des leads (${pasLead} sur ${n})`; }
    else if (!A.complet(noms)) { verdict = "retiré"; raison = "pas assez de champs fiables pour lire un lead (moyen de joindre + nom ou bien)"; }
    else if (gardesChamps.length < e.g.champs.length || e.refuses) { verdict = "corrigé"; raison = "champs retirés : " + e.g.champs.filter((c) => !noms.has(c.nom)).map((c) => `${c.nom} (${champs[c.nom] ? champs[c.nom].statut : "?"})`).concat(e.refuses ? [`${e.refuses} motif(s) dangereux ou invalides`] : []).join(", "); }
    else verdict = "fiable";
    const preuves = gardesChamps.filter((c) => COMPARES[c.nom]).map((c) => champs[c.nom].accord);
    if (verdict !== "retiré") gardes.push({ ...e.g, champs: gardesChamps, statut: "actif", nb_observations: Math.min(...preuves), nb_echecs: 0, origine: e.g.origine + ":verifie" });
    rapport.push({ id: e.l.id, source: e.l.source, version: e.l.version || null, nature: e.g.nature, mails: n, utiles_en_production: utiles, references: refs,
      champs: Object.fromEntries(Object.entries(champs).map(([k, T]) => [k, { accord: T.accord, desaccord: T.desaccord, invalide: T.invalide, non_lu: T.non_lu, sans_reference: T.sans_reference, statut: T.statut, ...(Object.keys(T.raisons).length ? { raisons: T.raisons } : {}) }])),
      verdict, ...(raison ? { raison } : {}) });
  }
  /* 4. nouveaux gabarits : l'IA lit les mails que personne ne sait lire, un par forme d'abord */
  let appris = [];
  if (apprendre && ia && IA.appels < iaMax && sansGabarit.length) {
    P.etape = "apprentissage de nouveaux gabarits par l'IA"; P.total = Math.min(iaMax - IA.appels, sansGabarit.length); P.fait = 0;
    const store = A.memoire([]);
    const vuesFormes = new Map();
    const file = sansGabarit.slice().sort((a, b) => { const fa = String(a.m.expediteur || "").split("@")[1] || "", fb = String(b.m.expediteur || "").split("@")[1] || ""; return fa.localeCompare(fb); });
    /* au plus 5 mails par expéditeur, pour couvrir le plus de formes possible */
    for (const x of file) {
      if (IA.appels >= iaMax) break;
      const d = String(x.m.expediteur || "").toLowerCase().split("@")[1] || "?";
      if ((vuesFormes.get(d) || 0) >= 5) continue;
      vuesFormes.set(d, (vuesFormes.get(d) || 0) + 1);
      const s = await lireIA(x); P.fait++;
      if (!s) continue;
      IA.apprentissage++;
      await A.apprendre(store, { mail: x.m, texte: x.texte, ia: s }).catch(() => null);
    }
    appris = store.tous().map((g) => ({ ...g, origine: "ia:verification" }));
  }
  const compte = (v) => rapport.filter((x) => x.verdict === v).length;
  return {
    gabarits: rapport.length, fiables: compte("fiable"), corriges: compte("corrigé"), retires: compte("retiré"),
    appris: { crees: appris.length, actifs: appris.filter((g) => g.statut === "actif").length },
    mails: mails.length, mails_sans_lecture: sansGabarit.length, ia: IA, detail: rapport, gardes, nouveaux: appris,
  };
};

module.exports = { verifier, FIABLE, plat, egal, lireChamp, invalide };
