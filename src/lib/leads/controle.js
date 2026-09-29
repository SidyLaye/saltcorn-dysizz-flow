/* Contrôle CRM ↔ mails : pour des leads déjà écrits dans le CRM (par un ancien système ou par celui-ci),
   compare ce qui est RÉELLEMENT dans le CRM avec ce que dit VRAIMENT le mail, et avec ce que le moteur
   écrirait aujourd'hui. Lecture seule : le CRM est ouvert sans droit d'écriture.

   Pour chaque lead : la fiche du contact (e-mail, téléphone, prénom, nom, origine, groupe, agence,
   négociateur, consentement et son motif), les biens qu'il suit. Le rapport ne contient AUCUNE donnée
   personnelle : des accords, des types d'écart, et le squelette anonymisé des mails en écart. */
"use strict";
const V = require("./valeurs");
const { texteMail, cle } = require("./texte");
const { traiter } = require("./traiter");
const M = require("./crm/memoire");
const { squelette, norm, identite, mots2 } = require("./banc");

const neuf = (x) => String(x || "").replace(/\D/g, "").slice(-9);
const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

/* lignes : [{ mail: { id, expediteur, destinataire, objet, texte, html, date }, contact_id, bien, negociateur, agence, source }]
   crm : adaptateur en lecture seule (contact(id), suivis(id)) ; biens : catalogue ; conf : configuration du moteur (consentement compris) */
const controler = async ({ lignes, crm, crmMoteur = null, biens = [], conf = {}, opts = {}, parCategorie = 4, maxCas = 300, groupeDemandeur = null, origines = [] }) => {
  /* le moteur cherche contacts et biens dans le vrai CRM (lecture seule) si on le lui donne, sinon dans le catalogue */
  const memoire = crmMoteur || M.creer({ biens });
  const parId = new Map(biens.map((b) => [String(b.id), b]));
  const origineParId = new Map(origines.map((o) => [String(o.id), o.code]));
  const confC = { ...conf, etapes: { ...(conf.etapes || {}), notification: false } };
  const R = { leads: lignes.length, lus_dans_le_crm: 0, introuvables_dans_le_crm: 0, erreurs_crm: 0, erreurs_moteur: 0, portails: {}, controles: {}, cas: [], categories: {} };
  const cat = new Map(), attente = [], df = new Map(), nb = new Map();
  const res = [];
  for (const l of lignes) {
    let d = null, k = null, suivis = null, errC = null, errM = null;
    try { d = await traiter({ ...l.mail }, memoire, confC, opts); } catch (e) { errM = e.message; R.erreurs_moteur++; }
    try {
      k = await crm.contact(l.contact_id);
      if (k && crm.suivis) suivis = await crm.suivis(l.contact_id).catch((e) => { errC = "suivis : " + e.message; return null; });
    } catch (e) { errC = e.message; R.erreurs_crm++; }
    if (k) R.lus_dans_le_crm++; else if (!errC) R.introuvables_dans_le_crm++;
    const t = texteMail({ texte: l.mail.texte, html: l.mail.html }).slice(0, 6000);
    const p = (d && d.extraction && d.extraction.portail) || "inconnu";
    if (!df.has(p)) { df.set(p, new Map()); nb.set(p, 0); }
    nb.set(p, nb.get(p) + 1);
    for (const w of new Set(cle(l.mail.objet + "\n" + t).split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !/\d/.test(w)))) df.get(p).set(w, (df.get(p).get(w) || 0) + 1);
    res.push({ l, d, k, suivis, errC, errM, t, p });
  }
  for (const { l, d, k, suivis, errC, errM, t, p } of res) {
    const P = R.portails[p] || (R.portails[p] = { leads: 0, controles: {} });
    P.leads++;
    const noter = (ctl, e, detail) => {
      inc(P.controles[ctl] || (P.controles[ctl] = {}), e); inc(R.controles[ctl] || (R.controles[ctl] = {}), e);
      if (e === "accord" || e === "rien à contrôler") return;
      const key = `${p}|${ctl}|${e}`; const n = (cat.get(key) || 0) + 1; cat.set(key, n);
      if (n <= parCategorie) attente.push({ key, l, d, t, p, ctl, e, detail });
    };
    if (errM) noter("moteur", "erreur : " + errM.slice(0, 80));
    if (errC) noter("lecture du crm", "erreur : " + errC.replace(/\d{3,}/g, "#").slice(0, 80));
    if (!k) { if (!errC) noter("fiche du contact", "introuvable dans le CRM"); continue; }
    const e = (d && d.extraction) || {}, c = e.contact || {};
    /* 0. RECHERCHE : le moteur retrouve-t-il la même fiche que celle où l'ancien a écrit ? */
    if (crmMoteur && d && d.contact) noter("recherche du contact", d.contact.id == null ? (d.contact.action === "creer" ? "le moteur créerait une nouvelle fiche" : "aucune fiche : " + String(d.contact.action || "?")) : String(d.contact.id) === String(l.contact_id) ? "accord" : "le moteur choisit une autre fiche");
    /* 1. e-mail et téléphone du mail retrouvés sur la fiche */
    const em = norm.email(c.email || c.email_relais), emK = (k.emails || [k.email]).map(norm.email).filter(Boolean);
    noter("e-mail", !em && !emK.length ? "rien à contrôler" : !em ? "sur la fiche, absent du mail" : !emK.length ? "dans le mail, absent de la fiche" : emK.includes(em) ? "accord" : emK.some((x) => x.split("@")[1] === em.split("@")[1]) ? "même domaine, adresse différente" : "adresse différente");
    const tm = neuf(c.telephone), tK = (k.telephones || []).map(neuf).filter(Boolean);
    noter("téléphone", !tm && !tK.length ? "rien à contrôler" : !tm ? "sur la fiche, absent du mail" : !tK.length ? "dans le mail, absent de la fiche" : tK.includes(tm) ? "accord" : "numéro différent");
    /* 2. prénom et nom */
    const dn = V.decouperNom(c.nom_complet || "") || {};
    const idM = mots2(c.prenom || dn.prenom, c.nom || dn.nom), idK = mots2(k.prenom, k.nom);
    const ei = identite(idK, idM);
    noter("prénom et nom", !ei ? "rien à contrôler" : ei === "absent chez nous" ? "sur la fiche, absent du mail" : ei === "absent chez l'ancien" ? "dans le mail, absent de la fiche" : ei, { mots_fiche: idK.length, mots_mail: idM.length, prenom_en_capitales: !!(k.prenom && k.prenom === k.prenom.toUpperCase() && /[A-Z]{2}/.test(k.prenom)) });
    if (k.prenom && /@|\d/.test(k.prenom + (k.nom || ""))) noter("prénom et nom", "valeur mal formée (chiffre ou @)");
    /* 3. origine : celle de la fiche, celle que le moteur mettrait */
    const oK = k.origine != null ? String(k.origine) : null, oA = d && d.origine && d.origine.id != null ? String(d.origine.id) : null;
    noter("origine", !oK && !oA ? "rien à contrôler" : !oK ? "absente de la fiche" : !oA ? "le moteur n'en trouve pas" : oK === oA ? "accord" : `différente (fiche ${origineParId.get(oK) || "?"} / moteur ${origineParId.get(oA) || "?"})`);
    /* 4. groupe « Demandeur » */
    if (groupeDemandeur != null) noter("groupe Demandeur", (k.groupes || []).map(String).includes(String(groupeDemandeur)) ? "accord" : "absent de la fiche");
    /* 5. bien : suivi sur la fiche ; négociateur et agence de la fiche = ceux du bien */
    const bienA = l.bien != null && l.bien !== "" ? String(l.bien) : null, bienM = d && d.bien ? String(d.bien.id) : null;
    const sv = suivis ? suivis.map((x) => x.bien) : null;
    if (bienA) noter("bien de l'ancien suivi sur la fiche", !sv ? "suivis illisibles" : sv.includes(bienA) ? "accord" : "non suivi");
    if (bienM) noter("bien du moteur suivi sur la fiche", !sv ? "suivis illisibles" : sv.includes(bienM) ? "accord" : bienA && bienA !== bienM ? "non suivi (l'ancien a choisi un autre bien)" : "non suivi");
    if (bienA && bienM) noter("même bien (ancien / moteur)", bienA === bienM ? "accord" : "différent");
    const b = parId.get(bienM || bienA || "");
    if (b && b.negociateur_id != null) noter("négociateur de la fiche = celui du bien", k.negociateur == null ? "absent de la fiche" : String(k.negociateur) === String(b.negociateur_id) ? "accord" : "différent");
    if (b && b.agence_id != null) noter("agence de la fiche = celle du bien", k.agence == null ? "absente de la fiche" : String(k.agence) === String(b.agence_id) ? "accord" : "différente");
    /* 6. consentement : posé si le moteur le poserait ; motif de 64 caractères au plus ; date = celle du mail */
    const veut = !!(d && (d.actions || []).some((x) => x.op === "ajouterConsentement"));
    const kc = k.consentement_detail;
    noter("consentement", k.consentement ? "présent sur la fiche" : veut ? "le moteur en poserait un, absent de la fiche" : "rien à contrôler");
    if (kc) {
      if (kc.raison && String(kc.raison).length > 64) noter("motif du consentement", "plus de 64 caractères");
      if (!kc.preuves) noter("preuve du consentement", "aucune preuve jointe");
      if (kc.date && l.mail.date && Math.abs(new Date(kc.date) - new Date(l.mail.date)) > 3 * 86400000) noter("date du consentement", "plus de 3 jours d'écart avec le mail");
    }
    /* 7. ÉCRITURE : ce que le moteur écrirait, champ par champ, au bon format et comparé à la fiche réelle */
    const ecr = (d && d.actions) || [];
    const fiche = ecr.find((x) => x.op === "creerContact") || ecr.find((x) => x.op === "majContact");
    const w0 = fiche ? { ...(fiche.donnees || {}), ...(fiche.champs || {}) } : null;
    const w = w0 ? { ...w0, telephone: w0.telephone || w0.mobile || null } : null;
    if (w) {
      const fmt = { email: (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v), telephone: (v) => /^\+\d{8,15}$/.test(String(v).replace(/\s/g, "")), prenom: (v) => !/[\d@]/.test(v) && String(v).trim().length > 1, nom: (v) => !/[\d@]/.test(v) && String(v).trim().length > 1,
        origine: (v) => /^\d+$/.test(String(v)), negociateur: (v) => /^\d+$/.test(String(v)), agence: (v) => /^\d+$/.test(String(v)) };
      for (const [ch, ok] of Object.entries(fmt)) if (w[ch] != null && w[ch] !== "" && !ok(w[ch])) noter("écriture : format", `${ch} mal formé`);
      const reel = { email: (k.emails || [k.email]).map(norm.email), telephone: (k.telephones || []).map(neuf), prenom: [norm.texte(k.prenom)], nom: [norm.texte(k.nom)], origine: [String(k.origine ?? "")], negociateur: [String(k.negociateur ?? "")], agence: [String(k.agence ?? "")] };
      const prevu = { email: norm.email(w.email), telephone: neuf(w.telephone), prenom: norm.texte(w.prenom), nom: norm.texte(w.nom), origine: String(w.origine ?? ""), negociateur: String(w.negociateur ?? ""), agence: String(w.agence ?? "") };
      for (const ch of Object.keys(prevu)) if (prevu[ch]) noter(`écriture : ${ch}`, reel[ch].includes(prevu[ch]) ? "accord" : !reel[ch].filter(Boolean).length ? "le moteur l'écrirait, absent de la fiche" : "le moteur écrirait une autre valeur");
    }
    for (const x of ecr.filter((y) => y.op === "lierBien")) { const bw = String((x.donnees && (x.donnees.bien ?? x.donnees.bienId)) ?? x.bien ?? ""); if (bw) noter("écriture : bien suivi", !sv ? "suivis illisibles" : sv.includes(bw) ? "accord" : "le moteur suivrait un bien que la fiche ne suit pas"); }
    const cw = ecr.find((x) => x.op === "ajouterConsentement");
    if (cw) {
      if (String(cw.motif || "").length > 64) noter("écriture : consentement", "motif de plus de 64 caractères");
      if (!(cw.preuves || []).length) noter("écriture : consentement", "sans preuve");
      if (l.mail.date && cw.date && Math.abs(new Date(cw.date) - new Date(l.mail.date)) > 86400000) noter("écriture : consentement", "date différente de celle du mail");
      else noter("écriture : consentement", "accord");
    }
  }
  /* cas : d'abord ce qui touche au prospect et au bien */
  const poids = (key) => { const [, ctl, e] = key.split("|"); return /erreur/.test(e) ? 9 : /^écriture/.test(ctl) && !/absent de la fiche/.test(e) ? 8 : /e-mail|téléphone/.test(ctl) && /différent/.test(e) ? 8 : /même bien|négociateur/.test(ctl) ? 7 : /prénom/.test(ctl) && /différent|mal formée/.test(e) ? 6 : /consentement/.test(ctl) ? 5 : /origine|groupe/.test(ctl) ? 4 : 2; };
  const ordre = [...cat.keys()].sort((a, b) => poids(b) - poids(a) || cat.get(b) - cat.get(a));
  const rang = new Map(ordre.map((k, i) => [k, i]));
  attente.sort((u, v) => rang.get(u.key) - rang.get(v.key));
  for (const x of attente.slice(0, maxCas)) {
    const seuil = Math.max(5, Math.ceil((nb.get(x.p) || 1) * 0.1)), dfp = df.get(x.p) || new Map();
    R.cas.push({ mail: x.l.mail.id, portail: x.p, controle: x.ctl, ecart: x.e, ...(x.detail ? { detail: x.detail } : {}), lu_par: x.d && x.d.extraction ? x.d.extraction.lu_par : null,
      motifs_moteur: ((x.d && x.d.motifs) || []).map((m) => m.replace(/[\w.+-]+@[\w.-]+/g, "[email]").replace(/\d{3,}/g, "#")).slice(0, 3),
      objet: squelette(x.l.mail.objet, dfp, seuil), squelette: squelette(x.t, dfp, seuil) });
  }
  R.categories = Object.fromEntries(ordre.map((k) => [k, cat.get(k)]));
  return R;
};

module.exports = { controler };
