/* Traitement complet d'un mail, sans effet de bord.
   L'unité de travail est le DOSSIER (prospect × bien) : un mail crée un dossier, le complète
   (relance, réponse du prospect) ou y ajoute la réponse de l'équipe. Le résultat dit tout ce qui
   serait fait et pourquoi ; les écritures sont faites à part (executer), selon le mode.

   opts.dossiers (facultatif) : { trouver(cles) → [dossiers] } — dossiers déjà connus du client
   dossier connu = { id, bien_id, reference, contact_id, recherche_id, negociateur, agence_id, messages: [...], maj_le } */
"use strict";
const { extraire } = require("./extraire");
const { rapprocher } = require("./rapprochement");
const { resoudreContact, completer } = require("./contact");
const { destinataires } = require("./routage");
const C = require("./conversation");

const NATURES_LEAD = ["lead", "relance", "recherche", "estimation", "direct"];
const ETAPES = ["bien", "contact", "suivi", "projet", "commentaire", "consentement", "action", "notification"];

const dateFr = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }); };
const gabarit = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));
const jourIso = (d) => { const x = new Date(d || Date.now()); return isNaN(x) ? "" : x.toISOString().slice(0, 10); };

/* Fichier .eml de la demande : preuve jointe au consentement. La source reçue est prise telle quelle si on l'a. */
const preuveEml = (mail) => {
  if (mail.source_eml) return { nom: `demande-${jourIso(mail.date || mail.date_envoi)}.eml`, type: "message/rfc822", base64: Buffer.from(String(mail.source_eml), "utf8").toString("base64") };
  const b = "dz" + Date.now().toString(36);
  const h = (s) => String(s || "").replace(/[\r\n]+/g, " ");
  const txt = [
    `From: ${h(mail.expediteur)}`, `To: ${h(mail.destinataire)}`, `Subject: ${h(mail.objet)}`,
    `Date: ${new Date(mail.date || mail.date_envoi || Date.now()).toUTCString()}`, mail.message_id ? `Message-ID: ${h(mail.message_id)}` : null, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=utf-8", "", String(mail.texte ?? mail.corps_texte ?? ""),
    ...(mail.html ?? mail.corps_html ? [`--${b}`, "Content-Type: text/html; charset=utf-8", "", String(mail.html ?? mail.corps_html)] : []),
    `--${b}--`, "",
  ].filter((x) => x !== null).join("\r\n");
  return { nom: `demande-${jourIso(mail.date || mail.date_envoi)}.eml`, type: "message/rfc822", base64: Buffer.from(txt, "utf8").toString("base64") };
};

/* Agence : par le bien, le compte du portail, la boîte qui a reçu le mail, puis l'agence citée. */
const trouverAgence = (r, bien, conf) => {
  const A = conf.agences || [];
  if (bien && bien.agence_id) { const a = A.find((x) => String(x.id) === String(bien.agence_id)); if (a) return { agence: a, par: "bien" }; }
  if (r.agence_crm) { const a = A.find((x) => String(x.id) === String(r.agence_crm) || String(x.id_crm || "") === String(r.agence_crm)); if (a) return { agence: a, par: "compte de l'agence sur le portail" }; }
  const dest = String(r.destinataire || "").toLowerCase();
  const a = A.find((x) => (x.boites || []).some((b) => dest.includes(String(b).toLowerCase())));
  if (a) return { agence: a, par: "boîte de réception" };
  if (r.agence_nommee) { const k = r.agence_nommee.toLowerCase(); const n = A.find((x) => k.includes(String(x.nom).toLowerCase()) || String(x.nom).toLowerCase().includes(k)); if (n) return { agence: n, par: "agence citée dans le mail" }; }
  return { agence: null, par: null };
};

/* Parmi les dossiers du prospect, celui qui concerne ce mail. */
const choisirDossier = (liste, { bienId, references = [], relais }) => {
  if (!liste || !liste.length) return null;
  const recents = liste.slice().sort((a, b) => String(b.maj_le || "").localeCompare(String(a.maj_le || "")));
  if (bienId) return recents.find((d) => String(d.bien_id) === String(bienId)) || null;
  const refs = references.map((x) => String(x).toLowerCase());
  const parRef = recents.find((d) => d.reference && refs.includes(String(d.reference).toLowerCase()));
  if (parRef) return parRef;
  /* le relais d'un portail (Leboncoin…) désigne une seule conversation, donc un seul bien */
  if (relais) { const r = recents.find((d) => String(d.relais || "").toLowerCase() === String(relais).toLowerCase()); if (r) return r; }
  return refs.length ? null : recents[0];
};

/* Critères du projet de recherche : ceux que le portail donne, sinon ceux du bien demandé, avec des marges. */
const criteresProjet = (r, bien, marges = {}) => {
  const R = r.recherche || {};
  const m = { prix: 0.1, surface: 0.2, pieces: 1, ...marges };
  const explicite = Object.values({ t: R.type, l: R.localisation, b: R.budget_max, s: R.surface_min, p: R.pieces_min }).filter(Boolean).length >= 2;
  if (explicite) return { source: "portail", transaction: r.projet === "location" ? "location" : "vente", type: R.type, localisation: R.localisation, budget_max: R.budget_max, surface_min: R.surface_min, pieces_min: R.pieces_min };
  if (!bien) return null;
  const prix = +bien.prix || +(r.bien && (r.bien.prix || r.bien.loyer)) || 0;
  return {
    source: "bien", transaction: r.projet === "location" ? "location" : "vente", type: bien.type || (r.bien && r.bien.type),
    localisation: [bien.code_postal, bien.ville].filter(Boolean).join(" ") || null,
    budget_max: prix ? Math.round(prix * (1 + m.prix)) : null,
    surface_min: +bien.surface ? Math.floor(+bien.surface * (1 - m.surface)) : null,
    pieces_min: +bien.pieces ? Math.max(1, +bien.pieces - m.pieces) : null,
  };
};

/* Négociateur nommé dans un titre (projet Giraffe « SHRODEZ_CARRIE-Nathalie_maison ») : prénom ET nom présents. */
const negociateurCite = (texte, personnes = []) => {
  const t = " " + String(texte || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const ok = personnes.filter((p) => p.role !== "assistante" && p.actif !== false && p.nom).filter((p) => {
    const mots = String(p.nom).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
    const alias = (p.alias || []).map((x) => " " + String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ").filter((x) => x.trim().length >= 2);
    return (mots.length >= 2 && mots.every((w) => t.includes(" " + w + " "))) || alias.some((x) => t.includes(x));
  });
  return ok.length === 1 ? ok[0] : null;
};

const vide = () => ({ statut: "ignore", motifs: [], actions: [], alertes: [] });

const traiter = async (mail, crm, conf = {}, opts = {}) => {
  const t0 = Date.now();
  const actif = Object.fromEntries(ETAPES.map((k) => [k, !(conf.etapes && conf.etapes[k] === false)]));
  const r = extraire(mail, conf);
  /* mail de portail transféré par l'agence : la conversation est celle du mail d'origine */
  const conv = C.messages(r.mail_deballe ? { ...mail, ...r.mail_deballe, html: "" } : mail, r, conf);
  const cles = C.cles(r, conv.texte, conf);
  const connus = opts.dossiers ? await opts.dossiers.trouver(cles).catch(() => []) : [];
  const d = { extraction: r, ...vide(), role: conv.role, fil: { cles, messages: conv.messages, dossiers_connus: connus.length } };
  const fin = () => { d.duree_ms = Date.now() - t0; return d; };

  /* 1. Message de l'équipe : jamais un lead. On l'ajoute au dossier s'il existe (réponse au prospect). */
  if (conv.role === "equipe" && r.nature === "interne") {
    const dos = choisirDossier(connus, { references: cles.references, relais: cles.relais });
    if (!dos) { d.motifs.push("message de l'équipe sans dossier connu : rien à faire"); return fin(); }
    r.nature = "reponse_equipe";
    d.statut = "suivi";
    d.dossier = { id: dos.id, existant: true, bien_id: dos.bien_id, contact_id: dos.contact_id, recherche_id: dos.recherche_id };
    const tous = C.fusionner(dos.messages || [], conv.messages);
    d.fil.messages_dossier = tous;
    d.fil.reponse_equipe = { date: mail.date || mail.date_envoi || null, auteur: (conv.messages[0] || {}).auteur || null };
    if (actif.commentaire && dos.contact_id && dos.recherche_id) d.actions.push({ op: "majRecherche", contact: dos.contact_id, id: dos.recherche_id, donnees: { comment: C.commentaire(tous, conf.commentaire || {}) } });
    return fin();
  }

  /* 2. Un mail qu'on ne sait pas classer, mais qui vient d'un prospect déjà suivi : c'est une relance. */
  if (["inconnu", "reponse_campagne", "direct"].includes(r.nature) && connus.length && conv.role === "prospect") {
    const dos = choisirDossier(connus, { references: cles.references, relais: cles.relais });
    if (dos) { r.nature = "relance"; r.reponse_client = true; if (dos.bien_id && !r.bien.id_crm && !r.bien.reference) { r.bien.id_crm = String(dos.bien_id); r.preuves["bien.id_crm"] = "dossier"; } }
  }

  /* Pas de référence dans le mail, mais une conversation connue (même relais, même e-mail) : le bien est celui du dossier. */
  if (NATURES_LEAD.includes(r.nature) && !r.bien.reference && !r.bien.id_crm && connus.length) {
    const pre = choisirDossier(connus, { references: cles.references, relais: cles.relais });
    if (pre && pre.bien_id) { r.bien.id_crm = String(pre.bien_id); r.preuves["bien.id_crm"] = "dossier"; }
  }

  if (!NATURES_LEAD.includes(r.nature)) {
    d.statut = ["inconnu", "reponse_campagne"].includes(r.nature) ? "a_trier" : r.nature === "alerte_spam" && (r.bloques || []).length ? "alerte" : "ignore";
    d.motifs.push(`nature : ${r.nature}`);
    if (r.nature === "alerte_spam" && (r.bloques || []).length) d.alertes.push(`${r.bloques.length} mail(s) de portail bloqué(s) par l'anti-spam : ${r.bloques.join(", ")}`);
    return fin();
  }
  if (r.suspect) d.motifs.push("à vérifier : " + r.suspect);
  if (r.a_un_bien_a_vendre) d.alertes.push("le prospect dit avoir aussi un bien à vendre : vendeur potentiel");
  if (r.portail === "inconnu") d.motifs.push(`nouvel expéditeur « ${r.portail_inconnu} » : à déclarer comme portail s'il en est un`);

  /* 3. Bien : celui du dossier si le mail n'en cite pas d'autre, sinon rapprochement. */
  let rb = { bien: null, methode: null, etapes: [], alertes: [] };
  if (actif.bien) {
    rb = await rapprocher(r, crm, conf.rapprochement || {});
    for (const a of rb.alertes || []) d.alertes.push(a);
  }
  d.bien = rb.bien; d.rapprochement = { methode: rb.methode, confiance: rb.confiance, motif: rb.motif, etapes: rb.etapes };
  if (actif.bien && !rb.bien && ["lead", "relance"].includes(r.nature)) d.motifs.push("bien non trouvé : " + rb.motif);
  if (rb.bien && rb.confiance === "basse") d.motifs.push("bien à confirmer : trouvé sur deux critères seulement");

  /* 4. Dossier : existant (même prospect, même bien) ou nouveau. */
  const dos = choisirDossier(connus, { bienId: rb.bien && rb.bien.id, references: cles.references, relais: cles.relais });
  d.dossier = dos
    ? { id: dos.id, existant: true, bien_id: (rb.bien && rb.bien.id) || dos.bien_id, contact_id: dos.contact_id, recherche_id: dos.recherche_id }
    : { id: null, existant: false, bien_id: rb.bien ? rb.bien.id : null, contact_id: null, recherche_id: null };
  d.dossier.cle = { relais: cles.relais, email: cles.email, telephone: cles.telephone, reference: (r.bien && (r.bien.reference || r.bien.id_crm)) || null };
  /* dans un dossier déjà ouvert, le message du prospect est une relance, signé du nom connu */
  if (dos) for (const m of conv.messages) if (m.role === "prospect" && m.source === "mail") { if (m.type === "demande") m.type = "relance"; if ((!m.auteur || m.auteur === "Prospect") && dos.nom) m.auteur = dos.nom; }
  const tous = C.fusionner((dos && dos.messages) || [], conv.messages);
  d.fil.messages_dossier = tous;

  /* 5. Agence et négociateur (le négociateur du dossier reste celui du bien) */
  const ag = trouverAgence(r, rb.bien, conf);
  d.agence = ag.agence ? { id: ag.agence.id, nom: ag.agence.nom, par: ag.par } : null;
  const negoId = rb.bien && rb.bien.negociateur_id ? rb.bien.negociateur_id : dos && dos.negociateur ? dos.negociateur : ag.agence && ag.agence.negociateur_defaut ? ag.agence.negociateur_defaut : null;
  let negoFinal = negoId;
  if (!negoFinal && r.bien && r.bien.titre) { const p = negociateurCite(r.bien.titre, (conf.routage && conf.routage.personnes) || []); if (p) { negoFinal = p.id; d.alertes.push(`négociateur trouvé par son nom dans le titre : ${p.nom}`); } }
  d.negociateur = negoFinal;
  if (!negoFinal) d.motifs.push("aucun négociateur (bien non trouvé et pas de négociateur par défaut pour l'agence)");

  /* 6. Contact */
  const c = { ...r.contact };
  if (!c.email && c.email_relais && conf.utiliser_relais !== false) { c.email = c.email_relais; d.alertes.push("e-mail du portail (relais) utilisé faute d'e-mail direct"); }
  let rc = { contact: null, action: "aucune", trace: [] };
  if (actif.contact) {
    rc = await resoudreContact(c, crm);
    if (rc.action !== "mettre_a_jour" && dos && dos.contact_id) {
      const ex = crm.contact ? await crm.contact(dos.contact_id).catch(() => null) : null;
      rc = { contact: ex || { id: dos.contact_id }, action: "mettre_a_jour", par: "dossier", trace: rc.trace.concat("contact repris du dossier") };
    }
    if (rc.action === "impossible") d.motifs.push("contact impossible : ni e-mail ni téléphone");
  }
  d.contact = { id: rc.contact ? rc.contact.id : null, action: rc.action, par: rc.par, trace: rc.trace };
  /* le contact est le propriétaire (vendeur) du bien : ce n'est pas un acquéreur */
  if (rb.bien && rb.bien.proprietaire_id && rc.contact && String(rb.bien.proprietaire_id) === String(rc.contact.id)) d.motifs.push("à vérifier : le mail vient du propriétaire du bien (vendeur), pas d'un acquéreur");

  /* 7. Origine */
  const origineCode = r.portail === "site_agence" ? r.site_origine : (conf.origines_portail || {})[r.portail] || r.portail;
  const origine = (conf.origines || []).find((o) => o.code === origineCode) || null;
  d.origine = origine ? { code: origine.code, libelle: origine.libelle, id: origine.id } : { code: origineCode, libelle: r.portail_nom, id: null };
  if (!origine && origineCode) d.alertes.push(`origine « ${origineCode} » non reliée à une origine du CRM`);

  /* 8. Plan CRM (rien n'est exécuté ici) */
  const ok = actif.contact && rc.action !== "impossible";
  if (ok && rc.action === "creer") d.actions.push({ op: "creerContact", donnees: { email: c.email, prenom: c.prenom, nom: c.nom, telephone: c.telephone, origine: d.origine.id, agence: d.agence && d.agence.id, negociateur: negoFinal } });
  if (ok && rc.action === "mettre_a_jour") {
    const patch = completer(rc.contact, c);
    if (negoFinal && rc.contact && "negociateur" in rc.contact && !rc.contact.negociateur) { patch.negociateur = negoFinal; if (d.agence) patch.agence = d.agence.id; }
    if (Object.keys(patch).length) d.actions.push({ op: "majContact", id: rc.contact.id, donnees: patch });
  }
  const nouveauBien = rb.bien && !(dos && String(dos.bien_id) === String(rb.bien.id));
  if (ok && actif.suivi && nouveauBien) d.actions.push({ op: "lierBien", bien: rb.bien.id });
  const comment = actif.commentaire ? C.commentaire(tous, conf.commentaire || {}) : null;
  if (ok && actif.projet) {
    if (dos && dos.recherche_id) { if (comment) d.actions.push({ op: "majRecherche", id: dos.recherche_id, donnees: { comment } }); }
    else {
      const cr = criteresProjet(r, rb.bien, conf.marges_projet);
      if (cr) d.actions.push({ op: "creerRecherche", donnees: { ...cr, libelle: `${r.portail_nom || r.portail || "Demande"}${rb.bien && rb.bien.reference ? " — réf. " + rb.bien.reference : ""}`, comment } });
    }
  }
  if (ok && actif.action && conf.action_lead && r.message) d.actions.push({ op: "ajouterAction", donnees: { action_id: conf.action_lead, negociateur: negoFinal, texte: [r.portail_nom, r.message].filter(Boolean).join(" — ").slice(0, 4000), date: mail.date || mail.date_envoi || null } });
  /* Consentement : un par contact (Immofacile n'en garde qu'un, mis à jour) — pas à chaque mail. */
  const dejaConsenti = (dos && dos.consentement) || (rc.contact && rc.contact.consentement) || connus.some((x) => x.consentement && rc.contact && String(x.contact_id) === String(rc.contact.id));
  if (ok && actif.consentement && conf.consentement && conf.consentement.actif && !dejaConsenti) {
    const date = mail.date || mail.date_envoi || new Date();
    const motif = gabarit(conf.consentement.libelle || "Demande de contact via {portail} du {date}", { portail: r.site || r.portail_nom || r.portail, date: dateFr(date) });
    d.actions.push({ op: "ajouterConsentement", date: new Date(date).toISOString(), motif, hors_horaires: r.hors_horaires, preuves: [preuveEml(mail)] });
  }

  /* 9. Destinataires. Une relance d'un dossier suivi ne va qu'au négociateur (et à son assistant(e)), sauf réglage. */
  if (actif.notification) {
    const dest = destinataires(negoFinal, mail.date || mail.date_envoi || new Date(), conf.routage || {});
    if (dos && (conf.notifier_relances || "negociateur") === "negociateur") {
      const avant = dest.liste.length;
      dest.liste = dest.liste.filter((x) => (x.roles || [x.role]).some((ro) => ["negociateur", "assistante"].includes(ro)));
      if (dest.liste.length < avant) dest.trace = (dest.trace || []).concat("relance d'un dossier déjà suivi : négociateur et assistant(e) seulement");
    }
    if ((conf.notifier_relances || "negociateur") === "non" && dos) dest.liste = [];
    d.destinataires = dest;
  }

  d.statut = d.motifs.length ? "a_verifier" : "pret";
  if (r.nature === "direct" && !rb.bien && !dos) { d.statut = "a_trier"; d.motifs.push("mail direct sans bien reconnu"); }
  if (r.suspect === "message de test") d.statut = "a_trier";
  return fin();
};

/* Exécute le plan : en mode « ombre », rien n'est écrit, tout est journalisé.
   Rend aussi les identifiants à garder dans le dossier (contact, projet de recherche). */
const executer = async (dossier, crm, { mode = "ombre" } = {}) => {
  const res = [];
  let contactId = dossier.contact && dossier.contact.id;
  let rechercheId = dossier.dossier && dossier.dossier.recherche_id;
  let consentement = false;
  for (const a of dossier.actions) {
    if (mode !== "reel") { res.push({ ...a, donnees: a.donnees && a.donnees.comment ? { ...a.donnees, comment: `(${a.donnees.comment.length} caractères)` } : a.donnees, preuves: a.preuves && a.preuves.map((p) => p.nom), fait: false, mode }); continue; }
    try {
      let out;
      if (a.op === "creerContact") { out = await crm.creerContact(a.donnees); contactId = out && out.id; }
      else if (a.op === "majContact") out = await crm.majContact(a.id, a.donnees);
      else if (a.op === "lierBien") out = await crm.lierBien(contactId, a.bien);
      else if (a.op === "creerRecherche") { out = crm.creerRecherche ? await crm.creerRecherche(contactId, a.donnees) : null; if (out && out.id) rechercheId = out.id; }
      else if (a.op === "majRecherche") out = crm.majRecherche ? await crm.majRecherche(a.contact || contactId, a.id, a.donnees) : null;
      else if (a.op === "ajouterAction") out = crm.ajouterAction ? await crm.ajouterAction(contactId, a.donnees) : null;
      else if (a.op === "ajouterConsentement") { out = await crm.ajouterConsentement(contactId, a); consentement = true; }
      res.push({ op: a.op, fait: out !== null, resultat: out && out.id ? { id: out.id } : !!out, ...(out === null ? { note: "non disponible avec ce CRM" } : {}), ...(out && out.non_pris ? { non_pris: out.non_pris, alerte: "écrit mais pas retrouvé à la relecture : " + out.non_pris.join(", ") } : {}) });
    } catch (e) { res.push({ op: a.op, fait: false, erreur: e.message }); if (a.op === "creerContact") break; }
  }
  return { contactId, rechercheId, consentement, resultats: res };
};

module.exports = { traiter, executer, preuveEml, trouverAgence, choisirDossier, criteresProjet, NATURES_LEAD, ETAPES };
