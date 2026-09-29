/* Banc d'essai : rejoue le moteur leads sur les mails d'un ancien système et compare, mail par mail,
   avec ce que cet ancien système avait trouvé. Rien n'est écrit (CRM en mémoire, rempli avec le catalogue
   de l'ancien système). Le rapport ne contient AUCUNE donnée personnelle :
   - accords et désaccords comptés par portail et par champ ;
   - type de chaque désaccord (ex. « mêmes 9 chiffres, format différent »), jamais les valeurs ;
   - squelette des mails en désaccord : les mots communs à beaucoup de mails du même portail (le gabarit)
     sont gardés, le reste devient « … », les adresses [email], les numéros [tel], les nombres #. */
"use strict";
const V = require("./valeurs");
const { texteMail, cle } = require("./texte");
const { traiter } = require("./traiter");
const M = require("./crm/memoire");

const norm = {
  email: (x) => (V.email(x) || "").toLowerCase(),
  tel: (x) => String(x || "").replace(/\D/g, "").slice(-9),
  texte: (x) => cle(String(x || "")).replace(/[^a-z0-9]/g, ""),
  ref: (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
  id: (x) => (x === null || x === undefined || x === "" ? "" : String(x).trim()),
};

/* Type d'un désaccord, sans la valeur */
const ecart = (champ, a, n) => {
  if (!a && !n) return null;
  if (!n) return "absent chez nous";
  if (!a) return "absent chez l'ancien";
  if (champ === "email") return a.split("@")[1] === n.split("@")[1] ? "même domaine, adresse différente" : "adresse différente";
  if (champ === "tel") return "numéro différent";
  if (champ === "reference") return a.includes(n) || n.includes(a) ? "l'une contient l'autre" : a.slice(0, -1) === n.slice(0, -1) ? "diffère par le dernier caractère" : "référence différente";
  if (champ === "nom" || champ === "prenom") return "valeur différente";
  return "différent";
};

/* Champs de l'ancien système (nom_champ libre) → champs comparés */
const CHAMP_ANCIEN = [
  [/^(email|e_?mail|mail|courriel|email_acquereur|email_prospect)$/, "email"],
  [/^(tel|telephone|phone|mobile|portable|tel_acquereur|telephone_acquereur)$/, "tel"],
  [/^(nom|lastname|last_name|nom_famille)$/, "nom"],
  [/^(prenom|firstname|first_name)$/, "prenom"],
  [/^(reference|ref|reference_bien|ref_bien|reference_annonce)$/, "reference"],
];
const champDeLAncien = (n) => { const k = cle(String(n || "")).replace(/[^a-z_]/g, ""); const x = CHAMP_ANCIEN.find(([re]) => re.test(k)); return x ? x[1] : null; };

/* Décision : ce qui arrive au mail */
const decisionAncienne = (statut, aUnLead) => (!aUnLead ? "pas de lead" : /rejet|quarant/i.test(String(statut)) ? "non automatisé" : "envoyé");
const decisionNouvelle = (st) => (st === "pret" ? "envoyé" : ["a_verifier", "a_trier"].includes(st) ? "non automatisé" : "pas de lead");

const mots = (t) => new Set(cle(t).split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !/\d/.test(w)));
const squelette = (texte, df, seuil) => String(texte || "")
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " [email] ")
  .replace(/(\+?\d[\d .-]{7,}\d)/g, " [tel] ")
  .split("\n").map((l) => l.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w) || /^\[(email|tel)\]$/.test(w)) return w;
    if (/\d/.test(w)) return w.replace(/\d+/g, "#");
    const k = cle(w).replace(/[^a-z0-9']/g, "");
    return !k || (df.get(k) || 0) >= seuil ? w : "…";
  }).join("").replace(/(…[\s…]*)+/g, "… ").trimEnd()).filter((l) => l.trim()).join("\n").slice(0, 2500);

/* mails : [{ id, expediteur, destinataire, objet, texte, html, date }]
   anciens : Map(mail_id → { source, statut, reference, bien, agence, negociateur, champs: { email, tel, nom, prenom, reference } })
   biens : catalogue de l'ancien système au format du moteur ({ id, reference, prix, surface, pieces, type, ville, code_postal, negociateur_id, agence_id })
   conf : configuration du moteur (agences, domaines_agence, portails déclarés…) */
const banc = async ({ mails, anciens, biens = [], conf = {}, opts = {}, maxCas = 400, parCategorie = 4, alias = {}, exemples = 3 }) => {
  const crm = M.creer({ biens });
  const confB = { ...conf, etapes: { ...(conf.etapes || {}), consentement: false, notification: false } };
  const R = { mails: mails.length, erreurs: 0, portails: {}, sources: {}, decisions: {}, champs_ancien_inconnus: {}, cas: [] };
  const res = [];
  /* 1. le moteur sur chaque mail */
  for (const m0 of mails) {
    let d = null, err = null;
    try {
      const x = await traiter({ ...m0, date: m0.date }, crm, confB, opts);
      const e = x.extraction || {};
      d = { statut: x.statut, motifs: x.motifs, bien: x.bien ? { id: x.bien.id } : null, agence: x.agence ? { id: x.agence.id } : null,
        negociateur: x.negociateur && typeof x.negociateur === "object" ? { id: x.negociateur.id } : x.negociateur || null,
        extraction: { portail: e.portail, portail_nom: e.portail_nom, nature: e.nature, lu_par: e.lu_par, contact: e.contact, bien: { reference: e.bien && e.bien.reference } } };
    } catch (e) { err = e.message; R.erreurs++; }
    res.push({ m: { id: m0.id, objet: String(m0.objet || ""), t: texteMail({ texte: m0.texte, html: m0.html }).slice(0, 6000) }, d, err });
  }
  /* 2. vocabulaire commun par portail (pour les squelettes) */
  const df = new Map(), nb = new Map();
  for (const { m, d } of res) {
    const p = (d && d.extraction && d.extraction.portail) || "inconnu";
    if (!df.has(p)) { df.set(p, new Map()); nb.set(p, 0); }
    nb.set(p, nb.get(p) + 1);
    for (const w of mots(m.objet + "\n" + m.t)) df.get(p).set(w, (df.get(p).get(w) || 0) + 1);
  }
  /* 3. comparaison */
  const cat = new Map();
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const { m, d, err } of res) {
    const a = anciens.get(m.id) || null;
    const x = (d && d.extraction) || {}, c = x.contact || {}, bm = x.bien || {};
    const p = x.portail || (err ? "erreur" : "inconnu");
    const P = R.portails[p] || (R.portails[p] = { mails: 0, natures: {}, decisions: {}, champs: {} });
    P.mails++; inc(P.natures, x.nature || "?");
    const decA = decisionAncienne(a && a.statut, !!a), decN = err ? "erreur" : decisionNouvelle(d && d.statut);
    inc(P.decisions, `${decA} → ${decN}`); inc(R.decisions, `${decA} → ${decN}`);
    if (a) {
      const srcA = norm.texte(a.source), srcN = norm.texte(x.portail), nomN = norm.texte(x.portail_nom);
      const memeSource = !!srcA && ((alias[srcA] || []).map(norm.texte).includes(srcN) || srcA === srcN || srcA === nomN || (srcN && srcA.includes(srcN)) || (nomN && srcA.includes(nomN)) || (srcN && srcN.includes(srcA)));
      inc(R.sources, `${a.source || "?"} → ${x.portail || "?"}${memeSource ? "" : " (?)"}`);
    }
    const diffs = [];
    if (a && decA !== "pas de lead") {
      const nous = { email: norm.email(c.email), tel: norm.tel(c.telephone), nom: norm.texte(c.nom || (V.decouperNom(c.nom_complet || "") || {}).nom), prenom: norm.texte(c.prenom || (V.decouperNom(c.nom_complet || "") || {}).prenom),
        reference: norm.ref(bm.reference), bien: norm.id(d && d.bien && d.bien.id), agence: norm.id(d && d.agence && d.agence.id), negociateur: norm.id(d && d.negociateur && (d.negociateur.id || d.negociateur)) };
      const eux = { email: norm.email(a.champs.email), tel: norm.tel(a.champs.tel), nom: norm.texte(a.champs.nom), prenom: norm.texte(a.champs.prenom),
        reference: norm.ref(a.champs.reference || a.reference), bien: norm.id(a.bien), agence: norm.id(a.agence), negociateur: norm.id(a.negociateur) };
      for (const k of Object.keys(nous)) {
        const C = P.champs[k] || (P.champs[k] = { accord: 0 });
        const e = nous[k] === eux[k] ? (nous[k] ? "accord" : null) : ecart(k, eux[k], nous[k]);
        if (!e) continue;
        inc(C, e);
        if (e !== "accord") diffs.push({ champ: k, ecart: e });
      }
    }
    if (decA !== decN && !(decA === "pas de lead" && decN === "pas de lead")) diffs.push({ champ: "decision", ecart: `${decA} → ${decN}` });
    if (err) diffs.push({ champ: "erreur", ecart: err.slice(0, 120) });
    /* un cas par catégorie (portail × champ × écart), quelques exemples chacun */
    for (const f of diffs) {
      const k = `${p}|${f.champ}|${f.ecart}`;
      const n = (cat.get(k) || 0) + 1; cat.set(k, n);
      if (n > parCategorie || R.cas.length >= maxCas) continue;
      const seuil = Math.max(3, Math.ceil((nb.get(p) || 1) * 0.05));
      R.cas.push({ mail: m.id, portail: p, nature: x.nature || null, lu_par: x.lu_par || null, champ: f.champ, ecart: f.ecart, motifs: ((d && d.motifs) || []).map((t) => t.replace(/[\w.+-]+@[\w.-]+/g, "[email]").replace(/\d{3,}/g, "#")).slice(0, 4),
        objet: squelette(m.objet, df.get(p) || new Map(), seuil), squelette: squelette(m.t, df.get(p) || new Map(), seuil) });
    }
  }
  R.categories = Object.fromEntries([...cat].sort((a, b) => b[1] - a[1]));
  /* quelques mails de chaque portail, même sans écart : pour voir leur forme (anonymisée) */
  R.exemples = [];
  const vus = new Map();
  for (const { m, d } of res) {
    const x = (d && d.extraction) || {}, p = x.portail || "inconnu";
    const n = (vus.get(p) || 0) + 1; if (n > exemples) continue; vus.set(p, n);
    const seuil = Math.max(3, Math.ceil((nb.get(p) || 1) * 0.05));
    R.exemples.push({ mail: m.id, portail: p, nature: x.nature || null, lu_par: x.lu_par || null, statut: d && d.statut, objet: squelette(m.objet, df.get(p) || new Map(), seuil), squelette: squelette(m.t, df.get(p) || new Map(), seuil) });
  }
  return R;
};

module.exports = { banc, squelette, ecart, champDeLAncien, norm };
