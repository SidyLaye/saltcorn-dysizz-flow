/* Traitement complet d'un mail de lead, sans effet de bord :
   extraction → bien → agence / négociateur → contact → plan d'actions CRM
   → consentement → destinataires. Le résultat (« dossier ») dit tout ce qui
   serait fait et pourquoi. L'exécution des écritures est séparée (executer). */
"use strict";
const { extraire } = require("./extraire");
const { rapprocher } = require("./rapprochement");
const { resoudreContact, completer } = require("./contact");
const { destinataires } = require("./routage");

const NATURES_LEAD = ["lead", "relance", "recherche", "estimation", "direct"];

const dateFr = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }); };
const gabarit = (t, v) => String(t).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));

/* Fichier .eml de la demande d'origine : preuve jointe au consentement. */
const preuveEml = (mail) => {
  const b = "dz" + Date.now().toString(36);
  const h = (s) => String(s || "").replace(/[\r\n]+/g, " ");
  const txt = [
    `From: ${h(mail.expediteur)}`, `To: ${h(mail.destinataire)}`, `Subject: ${h(mail.objet)}`,
    `Date: ${new Date(mail.date || mail.date_envoi || Date.now()).toUTCString()}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=utf-8", "", String(mail.texte ?? mail.corps_texte ?? ""),
    ...(mail.html ?? mail.corps_html ? [`--${b}`, "Content-Type: text/html; charset=utf-8", "", String(mail.html ?? mail.corps_html)] : []),
    `--${b}--`, "",
  ].join("\r\n");
  return { nom: `demande-${jourIso(mail.date || mail.date_envoi)}.eml`, type: "message/rfc822", base64: Buffer.from(txt, "utf8").toString("base64") };
};
const jourIso = (d) => { const x = new Date(d || Date.now()); return isNaN(x) ? "" : x.toISOString().slice(0, 10); };

/* Agence : par le bien, sinon par la boîte qui a reçu le mail, sinon par le négociateur nommé. */
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

const traiter = async (mail, crm, conf = {}) => {
  const t0 = Date.now();
  const r = extraire(mail, conf);
  const dossier = { extraction: r, statut: "ignore", motifs: [], actions: [], alertes: [], etapes: [] };
  if (!NATURES_LEAD.includes(r.nature)) {
    dossier.statut = ["inconnu", "reponse_campagne"].includes(r.nature) ? "a_trier" : r.nature === "alerte_spam" && (r.bloques || []).length ? "alerte" : "ignore";
    dossier.motifs.push(`nature : ${r.nature}`);
    if (r.nature === "alerte_spam" && (r.bloques || []).length) dossier.alertes.push(`${r.bloques.length} mail(s) de portail bloqué(s) par l'anti-spam : ${r.bloques.join(", ")}`);
    dossier.duree_ms = Date.now() - t0;
    return dossier;
  }

  if (r.suspect) dossier.motifs.push("à vérifier : " + r.suspect);
  /* Bien */
  const rb = await rapprocher(r, crm, conf.rapprochement || {});
  dossier.bien = rb.bien; dossier.rapprochement = { methode: rb.methode, confiance: rb.confiance, motif: rb.motif, etapes: rb.etapes };
  for (const a of rb.alertes || []) dossier.alertes.push(a);
  if (!rb.bien && ["lead", "relance"].includes(r.nature)) dossier.motifs.push("bien non trouvé : " + rb.motif);
  if (rb.bien && rb.confiance === "basse") dossier.motifs.push("bien à confirmer : trouvé sur deux critères seulement");

  /* Agence et négociateur */
  const ag = trouverAgence(r, rb.bien, conf);
  dossier.agence = ag.agence ? { id: ag.agence.id, nom: ag.agence.nom, par: ag.par } : null;
  const negoId = rb.bien && rb.bien.negociateur_id ? rb.bien.negociateur_id : ag.agence && ag.agence.negociateur_defaut ? ag.agence.negociateur_defaut : null;
  dossier.negociateur = negoId;
  if (!negoId) dossier.motifs.push("aucun négociateur (bien non trouvé et pas de négociateur par défaut pour l'agence)");

  /* Contact */
  const c = { ...r.contact };
  if (!c.email && c.email_relais && conf.utiliser_relais !== false) { c.email = c.email_relais; dossier.alertes.push("e-mail du portail (relais) utilisé faute d'e-mail direct"); }
  const rc = await resoudreContact(c, crm);
  dossier.contact = { id: rc.contact ? rc.contact.id : null, action: rc.action, par: rc.par, trace: rc.trace };
  if (rc.action === "impossible") dossier.motifs.push("contact impossible : ni e-mail ni téléphone");

  /* Origine */
  const origineCode = r.portail === "site_agence" ? r.site_origine : (conf.origines_portail || {})[r.portail] || r.portail;
  const origine = (conf.origines || []).find((o) => o.code === origineCode) || null;
  dossier.origine = origine ? { code: origine.code, libelle: origine.libelle, id: origine.id } : { code: origineCode, libelle: r.portail_nom, id: null };
  if (!origine) dossier.alertes.push(`origine « ${origineCode} » non reliée à une origine du CRM`);

  /* Plan d'actions CRM (rien n'est exécuté ici) */
  if (rc.action === "creer") dossier.actions.push({ op: "creerContact", donnees: { email: c.email, prenom: c.prenom, nom: c.nom, telephone: c.telephone, origine: dossier.origine.id, agence: dossier.agence && dossier.agence.id, negociateur: negoId } });
  if (rc.action === "mettre_a_jour") {
    const patch = completer(rc.contact, c);
    /* Contact sans négociateur dans le CRM : on le rattache à celui du bien (jamais de changement s'il en a un). */
    if (negoId && rc.contact && "negociateur" in rc.contact && !rc.contact.negociateur) { patch.negociateur = negoId; if (dossier.agence) patch.agence = dossier.agence.id; }
    if (Object.keys(patch).length) dossier.actions.push({ op: "majContact", id: rc.contact.id, donnees: patch });
  }
  if (rb.bien && rc.action !== "impossible") dossier.actions.push({ op: "lierBien", bien: rb.bien.id, note: [r.portail_nom, r.message].filter(Boolean).join(" — ").slice(0, 4000) });
  const R = r.recherche || {};
  if (rc.action !== "impossible" && (r.nature === "recherche" || Object.keys(R).length)) {
    const cr = { type: R.type, budget_max: R.budget_max, surface_min: R.surface_min, pieces_min: R.pieces_min, localisation: R.localisation, libelle: `Recherche ${r.portail_nom || r.portail || ""}`.trim() };
    if (Object.values(cr).filter(Boolean).length > 1) dossier.actions.push({ op: "creerRecherche", donnees: cr });
  }
  if (conf.consentement && conf.consentement.actif && rc.action !== "impossible") {
    const date = mail.date || mail.date_envoi || new Date();
    const motif = gabarit(conf.consentement.libelle || "Demande de contact via {portail} du {date}", { portail: r.site || r.portail_nom || r.portail, date: dateFr(date) });
    dossier.actions.push({ op: "ajouterConsentement", date: new Date(date).toISOString(), motif, preuves: [preuveEml(mail)] });
  }

  /* Destinataires (calculés même si l'envoi est coupé : c'est ce que montre le bouton « tester ») */
  dossier.destinataires = destinataires(negoId, mail.date || mail.date_envoi || new Date(), conf.routage || {});

  dossier.statut = dossier.motifs.length ? "a_verifier" : "pret";
  /* Mail direct sans bien reconnu : ce n'est peut-être pas un lead, on le range « à trier ». */
  if (r.nature === "direct" && !rb.bien) { dossier.statut = "a_trier"; dossier.motifs.push("mail direct sans bien reconnu"); }
  if (r.suspect === "message de test") dossier.statut = "a_trier";
  dossier.duree_ms = Date.now() - t0;
  return dossier;
};

/* Exécute le plan : en mode « ombre », rien n'est écrit, tout est journalisé. */
const executer = async (dossier, crm, { mode = "ombre" } = {}) => {
  const res = [];
  let contactId = dossier.contact && dossier.contact.id;
  for (const a of dossier.actions) {
    if (mode !== "reel") { res.push({ ...a, preuves: a.preuves && a.preuves.map((p) => p.nom), fait: false, mode }); continue; }
    try {
      let out;
      if (a.op === "creerContact") { out = await crm.creerContact(a.donnees); contactId = out && out.id; }
      else if (a.op === "majContact") out = await crm.majContact(a.id, a.donnees);
      else if (a.op === "lierBien") out = await crm.lierBien(contactId, a.bien, a.note);
      else if (a.op === "ajouterConsentement") out = await crm.ajouterConsentement(contactId, a);
      else if (a.op === "creerRecherche") out = crm.creerRecherche ? await crm.creerRecherche(contactId, a.donnees) : null;
      res.push({ op: a.op, fait: true, resultat: out && out.id ? { id: out.id } : !!out, ...(out && out.non_pris ? { non_pris: out.non_pris, alerte: "écrit mais pas retrouvé à la relecture : " + out.non_pris.join(", ") } : {}) });
    } catch (e) { res.push({ op: a.op, fait: false, erreur: e.message }); if (a.op === "creerContact") break; }
  }
  return { contactId, resultats: res };
};

module.exports = { traiter, executer, preuveEml, trouverAgence, NATURES_LEAD };
