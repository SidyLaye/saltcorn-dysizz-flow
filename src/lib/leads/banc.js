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
const { aCompleter } = require("./lecture");
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
  [/^(nom_complet|nomcomplet|full_name|fullname)$/, "nom_complet"],
  [/^(email|e_?mail|mail|courriel|email_acquereur|email_prospect)$/, "email"],
  [/^(tel|telephone|phone|mobile|portable|tel_acquereur|telephone_acquereur)$/, "tel"],
  [/^(nom|lastname|last_name|nom_famille)$/, "nom"],
  [/^(prenom|firstname|first_name)$/, "prenom"],
  [/^(reference|ref|reference_bien|ref_bien|reference_annonce)$/, "reference"],
];
const champDeLAncien = (n) => { const k = cle(String(n || "")).replace(/[^a-z_]/g, ""); const x = CHAMP_ANCIEN.find(([re]) => re.test(k)); return x ? x[1] : null; };

/* Décision : ce qui arrive au mail */
const decisionAncienne = (statut, aUnLead) => (!aUnLead ? "pas de lead" : /rejet|quarant/i.test(String(statut)) ? "non automatisé" : "envoyé");
const decisionNouvelle = (st, nature) => (st === "pret" ? "envoyé" : ["a_verifier", "a_trier"].includes(st) && !["inconnu", "reponse_campagne"].includes(nature) ? "non automatisé" : "pas de lead");

/* forme d'une référence, sans sa valeur : lettres → A, chiffres → 9 (« SEHA1234 » → « AAAA9999 ») */
const forme = (x) => String(x || "").toUpperCase().replace(/[A-Z]/g, "A").replace(/[0-9]/g, "9").slice(0, 30);
/* identité : les mots du prénom et du nom, dans n'importe quel ordre */
const mots2 = (...v) => [...new Set(v.flatMap((x) => cle(String(x || "")).split(/[^a-z]+/).filter((w) => w.length > 1)))].sort();
const identite = (a, n) => {
  if (!a.length && !n.length) return null;
  if (!n.length) return "absent chez nous";
  if (!a.length) return "absent chez l'ancien";
  if (a.join(" ") === n.join(" ")) return "accord";
  const communs = a.filter((w) => n.includes(w)).length;
  return communs === Math.min(a.length, n.length) ? "l'un contient l'autre" : communs ? "en partie" : "différent";
};

const mots = (t) => new Set(cle(t).split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !/\d/.test(w)));
const motMasque = (df, seuil) => (w) => {
  if (!w || /^\s+$/.test(w) || /^\[(email|tel)\]$/.test(w)) return w;
  if (/\d/.test(w)) return w.replace(/\d+/g, "#");
  const k = cle(w).replace(/[^a-z0-9']/g, "");
  return !k || (df.get(k) || 0) >= seuil ? w : "…";
};
/* valeur après « Libellé : » : toujours masquée (un nom qui revient souvent ne doit jamais passer) ; une référence garde sa forme */
const valeurMasquee = (v) => v.split(/(\s+)/).map((w) => (!w || /^\s+$/.test(w) || /^\[(email|tel)\]$/.test(w) ? w : /\d/.test(w) && w.length <= 24 ? forme(w) : "…")).join("").replace(/(…[\s…]*)+/g, "… ").trim();
const squelette = (texte, df, seuil) => String(texte || "")
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " [email] ")
  .replace(/(\+?\d[\d .-]{7,}\d)/g, " [tel] ")
  .split("\n").map((l) => {
    const lv = l.match(/^(\s*[^:\n]*[A-Za-zÀ-ÿ][^:\n]{0,40}?)\s*:\s*(\S.*)$/);
    const m = motMasque(df, seuil);
    if (lv && !/^https?$/i.test(lv[1].trim())) return lv[1].split(/(\s+)/).map(m).join("") + " : " + valeurMasquee(lv[2]);
    return l.split(/(\s+)/).map(m).join("").replace(/(…[\s…]*)+/g, "… ").trimEnd();
  }).filter((l) => l.trim()).join("\n").slice(0, 2500);
const seuilDe = (n) => Math.max(5, Math.ceil((n || 1) * 0.1));

/* mails : [{ id, expediteur, destinataire, objet, texte, html, date }]
   anciens : Map(mail_id → { source, statut, reference, bien, agence, negociateur, champs: { email, tel, nom, prenom, reference } })
   biens : catalogue de l'ancien système au format du moteur ({ id, reference, prix, surface, pieces, type, ville, code_postal, negociateur_id, agence_id })
   conf : configuration du moteur (agences, domaines_agence, portails déclarés…) */
const banc = async ({ mails, anciens, biens = [], conf = {}, opts = {}, maxCas = 400, parCategorie = 4, alias = {}, exemples = 3, iaEchantillon = 0, progres = null }) => {
  const P0 = progres || {};
  const crm = M.creer({ biens });
  const confB = { ...conf, etapes: { ...(conf.etapes || {}), consentement: false, notification: false } };
  const R = { mails: mails.length, erreurs: 0, portails: {}, par_lecture: {}, sources: {}, decisions: {}, champs_ancien_inconnus: {}, cas: [] };
  const res = [];
  /* IA : appels comptés ; jamais plus que l'échantillon demandé */
  const IA = { appels: 0, erreurs: 0, cache: 0, echantillon: 0, par_portail: {} };
  const { borne } = require("../arriere_plan");
  const avecIA = opts.ia ? { ...opts, ia: { lire: async (m, t) => { IA.appels++; try { const x = await borne(opts.ia.lire(m, t), 90000, "IA"); if (x && x.cache) IA.cache++; return x; } catch (e) { IA.erreurs++; throw e; } } } } : null;
  const sansIA = { ...opts }; delete sansIA.ia; delete sansIA.budget; delete sansIA.noter;
  const gab0 = opts.gabarits && opts.gabarits.tous ? opts.gabarits.tous().length : null;
  /* 1. le moteur sur chaque mail (règles et gabarits ; l'IA vient ensuite, sur un échantillon) */
  const rejouer = async (m0, o) => {
    let d = null, err = null;
    try {
      const x = await traiter({ ...m0, date: m0.date }, crm, confB, o);
      const e = x.extraction || {};
      const rb = x.rapprochement || null;
      d = { statut: x.statut, motifs: x.motifs, bien: x.bien ? { id: x.bien.id } : null,
        rapprochement: rb ? { methode: rb.methode || null, confiance: rb.confiance || null, motif: rb.motif || null,
          etapes: (rb.etapes || []).map((e) => ({ etape: e.etape, trouves: e.trouves, ambigu: !!e.ambigu, raisons: (e.candidats || []).map((c) => c.raison).filter(Boolean).slice(0, 3) })) } : null, agence: x.agence ? { id: x.agence.id } : null,
        negociateur: x.negociateur && typeof x.negociateur === "object" ? { id: x.negociateur.id } : x.negociateur || null,
        extraction: { portail: e.portail, portail_nom: e.portail_nom, nature: e.nature, lu_par: e.lu_par, contact: e.contact, bien: { reference: e.bien && e.bien.reference, reference_portail: e.bien && e.bien.reference_portail } },
        /* le mail aurait eu besoin de l'IA, qui n'a pas été appelée (hors échantillon, ou IA coupée) */
        ia_manquante: !(e.lu_par || []).includes("ia") && aCompleter(e), ia: e.lecture && e.lecture.ia ? { statut: e.lecture.ia.statut } : null };
    } catch (e) { err = e.message; }
    return { m: { id: m0.id, date: m0.date, motif: m0.motif_ancien, regle: m0.regle_ancien, objet: String(m0.objet || ""), t: texteMail({ texte: m0.texte, html: m0.html }).slice(0, 6000) }, d, err };
  };
  P0.total = mails.length; P0.fait = 0;
  for (const m0 of mails) { res.push(await rejouer(m0, sansIA)); P0.fait++; }
  /* 1 bis. IA sur un échantillon des mails qu'elle seule peut lire, réparti entre les portails */
  if (avecIA && iaEchantillon > 0) {
    const files = new Map();
    res.forEach((x, i) => { if (x.d && x.d.ia_manquante) { const p = x.d.extraction.portail || "inconnu"; if (!files.has(p)) files.set(p, []); files.get(p).push(i); } });
    const choisis = [];
    for (let tour = 0; choisis.length < iaEchantillon && [...files.values()].some((f) => f.length > tour); tour++)
      for (const f of files.values()) if (f[tour] !== undefined && choisis.length < iaEchantillon) choisis.push(f[tour]);
    choisis.sort((a, b) => a - b);
    IA.echantillon = choisis.length;
    P0.etape = "lecture par l'IA"; P0.total = choisis.length; P0.fait = 0;
    for (const i of choisis) { P0.fait++; res[i] = await rejouer(mails[i], avecIA); const p = (res[i].d && res[i].d.extraction.portail) || "inconnu"; IA.par_portail[p] = (IA.par_portail[p] || 0) + 1; }
  }
  /* 1 ter. ce que l'IA a appris sert aux autres mails de la même forme (comme en production) */
  if (gab0 !== null && opts.gabarits.tous().length > gab0) {
    IA.relus_avec_gabarits_appris = 0;
    for (let i = 0; i < res.length; i++) if (res[i].d && res[i].d.ia_manquante) { res[i] = await rejouer(mails[i], sansIA); if (res[i].d && !res[i].d.ia_manquante) IA.relus_avec_gabarits_appris++; }
  }
  R.erreurs = res.filter((x) => x.err).length;
  R.ia = IA;
  if (gab0 !== null) { const n = opts.gabarits.tous().slice(gab0); R.gabarits_appris_pendant_le_banc = { crees: n.length, actifs: n.filter((g) => g.statut === "actif").length }; }
  R.lecture = {};
  for (const { d } of res) if (d) { const k = d.ia_manquante ? "IA nécessaire, non appelée" : (d.extraction.lu_par || ["regles"]).join("+"); R.lecture[k] = (R.lecture[k] || 0) + 1; }
  /* 2. vocabulaire commun par portail (pour les squelettes) */
  const catalogue = new Set(biens.map((b) => String(b.id)));
  const df = new Map(), nb = new Map();
  for (const { m, d } of res) {
    const p = (d && d.extraction && d.extraction.portail) || "inconnu";
    if (!df.has(p)) { df.set(p, new Map()); nb.set(p, 0); }
    nb.set(p, nb.get(p) + 1);
    for (const w of mots(m.objet + "\n" + m.t)) df.get(p).set(w, (df.get(p).get(w) || 0) + 1);
  }
  /* 3. comparaison */
  const cat = new Map(), attente = [];
  const parId = new Map(biens.map((b) => [String(b.id), b]));
  /* où l'ancien a-t-il lu son bien ? la ligne du mail qui porte sa référence ou l'identifiant du bien (anonymisée) */
  const ouAncien = (m, a, dfp, seuil) => {
    const b = a && a.bien !== null && a.bien !== undefined ? parId.get(String(a.bien)) : null;
    const essais = [["reference_de_l_ancien", a && (a.champs.reference || a.reference)], ["reference_du_bien", b && b.reference], ["id_du_bien", a && a.bien]].filter(([, v]) => v !== null && v !== undefined && String(v).trim().length >= 2);
    const lignes = (m.objet + "\n" + m.t).split("\n");
    for (const [quoi, v] of essais) {
      const re = new RegExp("(^|[^\\w])" + String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])", "i");
      const i = lignes.findIndex((l) => re.test(l));
      if (i >= 0) return { quoi, forme: forme(v), ligne: i === 0 ? "(objet)" : "ligne " + i, texte: (() => { const l = lignes[i], mm = l.match(re), j = mm.index + mm[1].length; return (squelette(l.slice(0, j), dfp, seuil) + " [CETTE_VALEUR] " + squelette(l.slice(j + String(v).trim().length), dfp, seuil)).trim().slice(0, 160); })(), avant: i > 0 ? squelette(lignes[i - 1], dfp, seuil).slice(0, 120) : null };
    }
    return essais.length ? { quoi: "absente du mail", formes: essais.map(([q, v]) => q + " " + forme(v)) } : null;
  };
  const masqueMotif = (t) => String(t || "").replace(/[\w.+-]+@[\w.-]+/g, "[email]").replace(/["«“][^"»”]{0,120}["»”]/g, "\"…\"").replace(/\d+/g, "#").slice(0, 80);
  R.motifs_ancien = {}; R.regles_ancien = {};
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const { m, d, err } of res) {
    const a = anciens.get(m.id) || null;
    const x = (d && d.extraction) || {}, c = x.contact || {}, bm = x.bien || {};
    const p = x.portail || (err ? "erreur" : "inconnu");
    const P = R.portails[p] || (R.portails[p] = { mails: 0, natures: {}, decisions: {}, champs: {} });
    P.mails++; inc(P.natures, x.nature || "?");
    const decA = decisionAncienne(a && a.statut, !!a), decN = err ? "erreur" : d && d.ia_manquante && d.statut !== "pret" ? "IA non appelée" : decisionNouvelle(d && d.statut, x.nature);
    inc(P.decisions, `${decA} → ${decN}`); inc(R.decisions, `${decA} → ${decN}`);
    if (a) {
      const srcA = norm.texte(a.source), srcN = norm.texte(x.portail), nomN = norm.texte(x.portail_nom);
      const memeSource = !!srcA && ((alias[srcA] || []).map(norm.texte).includes(srcN) || srcA === srcN || srcA === nomN || (srcN && srcA.includes(srcN)) || (nomN && srcA.includes(nomN)) || (srcN && srcN.includes(srcA)));
      inc(R.sources, `${a.source || "?"} → ${x.portail || "?"}${memeSource ? "" : " (?)"}`);
    }
    const diffs = [];
    /* par étage de lecture (règles, gabarit, IA) : mesure de chaque étage sur les mêmes champs */
    const lec = d && !d.ia_manquante ? (x.lu_par || ["regles"]).slice(-1)[0] : null;
    const L = lec ? (R.par_lecture[lec] || (R.par_lecture[lec] = { mails: 0, decisions: {}, champs: {} })) : null;
    if (L) { L.mails++; inc(L.decisions, `${decA} → ${decN}`); }
    const noterChamp = (k, e) => { inc(P.champs[k] || (P.champs[k] = { accord: 0 }), e); if (L) inc(L.champs[k] || (L.champs[k] = { accord: 0 }), e); };
    if (d && d.ia_manquante) P.ia_manquante = (P.ia_manquante || 0) + 1;
    if (a && decA !== "pas de lead" && !(d && d.ia_manquante)) {
      const nous = { email: norm.email(c.email || c.email_relais), tel: norm.tel(c.telephone), nom: norm.texte(c.nom || (V.decouperNom(c.nom_complet || "") || {}).nom), prenom: norm.texte(c.prenom || (V.decouperNom(c.nom_complet || "") || {}).prenom),
        reference: norm.ref(bm.reference), bien: norm.id(d && d.bien && d.bien.id), agence: norm.id(d && d.agence && d.agence.id), negociateur: norm.id(d && d.negociateur && (d.negociateur.id || d.negociateur)) };
      const eux = { email: norm.email(a.champs.email), tel: norm.tel(a.champs.tel), nom: norm.texte(a.champs.nom), prenom: norm.texte(a.champs.prenom),
        reference: norm.ref(a.champs.reference || a.reference), bien: norm.id(a.bien), agence: norm.id(a.agence), negociateur: norm.id(a.negociateur) };
      const dn = V.decouperNom(c.nom_complet || "") || {};
      const idN = mots2(c.prenom || dn.prenom, c.nom || dn.nom), idA = mots2(a.champs.prenom, a.champs.nom, a.champs.nom_complet);
      for (const k of Object.keys(nous)) {
        let e = nous[k] === eux[k] ? (nous[k] ? "accord" : null) : ecart(k, eux[k], nous[k]);
        if (k === "bien" && e && e !== "accord" && eux.bien && !catalogue.has(eux.bien)) e = "bien de l'ancien absent du catalogue";
        if (k === "bien" && e === "absent chez l'ancien") { const b = parId.get(nous.bien); if (b && b.cree_le && m.date && new Date(b.cree_le) > new Date(m.date)) e = "bien ajouté au catalogue après le mail"; }
        if (!e) continue;
        noterChamp(k, e);
        /* nom et prénom séparés : comptés, mais un écart ne compte que sur l'identité entière (ci-dessous) */
        if (e !== "accord" && k !== "nom" && k !== "prenom") diffs.push({ champ: k, ecart: e, ...(k === "reference" ? { forme_ancien: forme(eux.reference), forme_nous: forme(nous.reference), forme_portail: forme(norm.ref(bm.reference_portail)) } : {}) });
      }
      const ei = identite(idA, idN);
      if (ei) { noterChamp("identite", ei); if (ei !== "accord") diffs.push({ champ: "identite", ecart: ei, mots_ancien: idA.length, mots_nous: idN.length }); }
    }
    if (decA !== decN && !(decA === "pas de lead" && decN === "pas de lead")) {
      diffs.push({ champ: "decision", ecart: `${decA} → ${decN}` });
      const kd = `${decA} → ${decN}`;
      if (m.motif) inc(R.motifs_ancien[kd] || (R.motifs_ancien[kd] = {}), masqueMotif(m.motif));
      if (m.regle) inc(R.regles_ancien[kd] || (R.regles_ancien[kd] = {}), masqueMotif(m.regle));
    }
    if (err) diffs.push({ champ: "erreur", ecart: err.slice(0, 120) });
    /* un cas par catégorie (portail × champ × écart), quelques exemples chacun */
    for (const f of diffs) {
      const k = `${p}|${f.champ}|${f.ecart}${f.forme_ancien !== undefined ? ` (${f.forme_ancien} / ${f.forme_nous})` : ""}`;
      const n = (cat.get(k) || 0) + 1; cat.set(k, n);
      if (n <= parCategorie) attente.push({ k, m, d, x, p, f, a });
    }
  }
  /* cas montrés : d'abord les écarts qui changent qui reçoit le lead ou comment on joint le prospect */
  const gravite = (k) => { const [, ch, ec] = k.split("|");
    if (ch === "erreur") return 11;
    if (ch === "bien" && /^différent/.test(ec)) return 10;
    if ((ch === "email" || ch === "tel") && /différent/.test(ec)) return 9;
    if (ch === "identite" && /^(différent|en partie)/.test(ec)) return 8;
    if (ch === "decision" && /^(envoyé → (non automatisé|pas de lead)|pas de lead → envoyé)/.test(ec)) return 7;
    if ((ch === "negociateur" || ch === "agence") && /^différent/.test(ec)) return 7;
    if (ch === "decision" && /^non automatisé → envoyé/.test(ec)) return 6;
    if (ch === "bien" && /absent chez nous/.test(ec)) return 6;
    if (ch === "reference" && /différente/.test(ec)) return 5;
    return /absent chez l'ancien|ajouté au catalogue/.test(ec) ? 0 : 2; };
  const ordre = [...cat.keys()].sort((a, b) => gravite(b) - gravite(a) || cat.get(b) - cat.get(a));
  const rang = new Map(ordre.map((k, i) => [k, i]));
  attente.sort((u, v) => rang.get(u.k) - rang.get(v.k));
  for (const { m, d, x, p, f, a } of attente.slice(0, maxCas)) {
    const seuil = seuilDe(nb.get(p)), dfp = df.get(p) || new Map();
    const ou = a && a.bien !== null && a.bien !== undefined && ((f.champ === "bien" && f.ecart !== "accord") || f.champ === "decision" || f.champ === "reference") ? ouAncien(m, a, dfp, seuil) : null;
    R.cas.push({ mail: m.id, portail: p, nature: x.nature || null, lu_par: x.lu_par || null, ...f, gravite: gravite(`${p}|${f.champ}|${f.ecart}`), ...(ou ? { ou_l_ancien_a_lu_son_bien: ou } : {}),
      motif_ancien: m.motif ? masqueMotif(m.motif) : null, regle_ancien: m.regle ? masqueMotif(m.regle) : null,
      rapprochement: d && d.rapprochement, motifs: ((d && d.motifs) || []).map((t) => t.replace(/[\w.+-]+@[\w.-]+/g, "[email]").replace(/\d{3,}/g, "#")).slice(0, 4),
      objet: squelette(m.objet, dfp, seuil), squelette: squelette(m.t, dfp, seuil) });
  }
  R.categories = Object.fromEntries(ordre.map((k) => [k, cat.get(k)]));
  /* quelques mails de chaque portail, même sans écart : pour voir leur forme (anonymisée) */
  R.exemples = [];
  const vus = new Map();
  for (const { m, d } of res) {
    const x = (d && d.extraction) || {}, p = x.portail || "inconnu";
    const n = (vus.get(p) || 0) + 1; if (n > exemples) continue; vus.set(p, n);
    const seuil = seuilDe(nb.get(p));
    R.exemples.push({ mail: m.id, portail: p, nature: x.nature || null, lu_par: x.lu_par || null, statut: d && d.statut, objet: squelette(m.objet, df.get(p) || new Map(), seuil), squelette: squelette(m.t, df.get(p) || new Map(), seuil) });
  }
  return R;
};

module.exports = { banc, squelette, ecart, champDeLAncien, norm, forme, identite, mots2 };

/* Domaines de l'agence pour le banc et les contrôles : ceux donnés, ceux des réglages Leads, et ceux des boîtes
   des agences (sauf messageries publiques) — un champ laissé vide ne fait plus prendre l'équipe pour un prospect. */
const PUBLICS = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|orange|wanadoo|free|sfr|neuf|laposte|icloud|me|mac|aol|gmx|protonmail|proton|bbox|numericable|club-internet|aliceadsl|voila|libertysurf|tiscali)\./i;
const domainesAgence = (...sources) => [...new Set(sources.flat().flatMap((x) => String(x || "").toLowerCase().split(/[\s,;]+/))
  .map((x) => x.replace(/^.*@/, "").trim()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !PUBLICS.test(d)))];
module.exports.domainesAgence = domainesAgence;
