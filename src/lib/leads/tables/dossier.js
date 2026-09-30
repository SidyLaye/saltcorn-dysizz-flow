/* Traitement d'un mail de bout en bout, côté plateforme :
   configuration → CRM (avec le catalogue local) → verrou du dossier → moteur (lecture, fil, bien,
   contact, plan) → exécution selon le mode → ld_leads (trace du mail) + ld_dossiers / ld_evenements.
   Utilisé par le workflow (bloc dzf_leads_traiter), le bouton « retraiter » et le rejeu. */
"use strict";
const { tables, nom } = require("./schema");
const { charger } = require("./conf");
const { flowApi } = require("./core");
const fil = require("./fil");
const { avecCatalogue } = require("./catalogue");
const G = require("./gabarits");

const courte = (v, n = 900) => String(v == null ? "" : v).slice(0, n);
const sansCommentaire = (a) => (a && a.donnees && a.donnees.comment ? { ...a, donnees: { ...a.donnees, comment: `(${a.donnees.comment.length} caractères)` } } : a);
const versLigne = (d, mail = {}) => {
  const x = d.extraction || {}, c = x.contact || {}, b = d.bien || null;
  const ex = d.execution || {};
  return {
    mail_id: mail.id || null, message_id: courte(mail.message_id, 300), recu_le: mail.date_envoi || mail.recu_le || new Date(), traite_le: new Date(),
    expediteur: courte(mail.expediteur, 300), objet: courte(mail.objet, 400),
    portail: d.portail || (x.portail === "inconnu" || !x.portail ? x.portail_nom || x.portail || "" : x.portail), source: d.source || d.portail || x.portail_nom || x.portail || "", nature: x.nature || "", statut: d.statut, role: d.role || "", lu_par: (x.lu_par || []).join("+"),
    contact_nom: courte([c.prenom, c.nom].filter(Boolean).join(" ") || c.nom_complet, 200), contact_email: c.email || c.email_relais || "", contact_tel: c.telephone || "",
    contact_crm: ex.contactId && !/^ombre-/.test(String(ex.contactId)) ? String(ex.contactId) : d.contact && d.contact.id ? String(d.contact.id) : "", contact_action: (d.contact && d.contact.action) || "",
    reference: (x.bien && (x.bien.reference || x.bien.id_crm || x.bien.reference_portail)) || "",
    bien_crm: b ? String(b.id) : "", bien_ref_crm: b ? String(b.reference || "") : "", bien_methode: (d.rapprochement && d.rapprochement.methode) || "", bien_confiance: (d.rapprochement && d.rapprochement.confiance) || "",
    agence: d.agence ? d.agence.nom : "", negociateur: d.negociateur ? String(d.negociateur) : "", origine: d.origine ? d.origine.libelle || d.origine.code : "", site: x.site || "",
    destinataires: d.destinataires ? d.destinataires.liste.map((l) => l.email).sort().join(", ") : "",
    motifs: (d.motifs || []).join(" · "), alertes: (d.alertes || []).join(" · "), mode: ex.mode || "ombre",
    actions: (d.actions || []).map((a) => a.op).join(", "),
    dossier: JSON.stringify({ ...d, fil: d.fil ? { ...d.fil, messages_dossier: undefined, nb_messages_dossier: (d.fil.messages_dossier || []).length } : undefined, actions: (d.actions || []).map((a) => sansCommentaire({ ...a, preuves: a.preuves && a.preuves.map((p) => p.nom) })) }).slice(0, 200000),
    duree_ms: d.duree_ms || 0,
  };
};

/* Chaque valeur lue dans le mail et d'où elle vient (règles, gabarit, IA, fiche…) : ld_champs */
const champsLus = (d) => {
  const x = d.extraction || {}, out = [];
  const val = (chemin) => chemin.split(".").reduce((o, k) => (o == null ? undefined : o[k]), x);
  for (const [chemin, prov] of Object.entries(x.preuves || {})) {
    const v = val(chemin);
    if (v === undefined || v === null || v === "" || typeof v === "object") continue;
    out.push({ champ: chemin, valeur: String(v).slice(0, 500), provenance: String(prov).slice(0, 200) });
  }
  return out;
};
const ecrireChamps = async (t, leadId, d) => {
  if (!t.champs) return;
  await t.champs.deleteRows({ lead: leadId });
  for (const c of champsLus(d)) await t.champs.insertRow({ lead: leadId, ...c });
};

const enregistrer = async (d, mail, dossierId = null) => {
  const t = await tables();
  const ligne = { ...versLigne(d, mail), dossier_id: dossierId };
  const ex = mail && mail.id ? await t.leads.getRow({ mail_id: mail.id }) : null;
  let id;
  if (ex) { await t.leads.updateRow({ ...ligne, decision: ex.decision || "", ancien_statut: ex.ancien_statut, ancien_bien: ex.ancien_bien, ancien_destinataires: ex.ancien_destinataires }, ex.id); id = ex.id; }
  else id = await t.leads.insertRow(ligne);
  await ecrireChamps(t, id, d).catch(() => {});
  return id;
};

const versMoteur = (mail) => ({ expediteur: mail.expediteur, destinataire: mail.destinataire, objet: mail.objet, texte: mail.corps_texte, html: mail.corps_html, date: mail.date_envoi, message_id: mail.message_id, in_reply_to: mail.in_reply_to, references: mail.references_fil, source_eml: mail.source_eml || null });

/* Clé du verrou : la personne qui écrit (relais du portail, e-mail, téléphone). Deux mails du même
   prospect sont traités l'un après l'autre, jamais en même temps (pas de double dossier). */
const cleVerrou = (api, m, conf, mailId) => {
  try {
    const r = api.leads.extraire(m, conf);
    const texte = api.leads.texte.texteMail({ texte: m.texte, html: m.html });
    const k = api.leads.conversation.cles(r, texte, conf);
    const v = k.relais || k.email || (k.telephone && String(k.telephone).replace(/\D/g, "").slice(-9));
    return v ? "dossier:" + String(v).toLowerCase() : "mail:" + mailId;
  } catch (e) { return "mail:" + mailId; }
};

/* Traite (ou retraite) un mail rangé dans ld_mails. */
const traiterMail = async (mailId, { forcerOmbre = false } = {}) => {
  const api = flowApi();
  if (!api) throw new Error("dysizz-flow 2.4 ou plus récent est nécessaire");
  const Table = require("@saltcorn/data/models/table");
  const tm = Table.findOne({ name: nom("mails") });
  const mail = tm && (await tm.getRow({ id: +mailId }));
  if (!mail) throw new Error("mail introuvable");
  const { conf, crm, reglages: R } = await charger();
  const mode = forcerOmbre ? "ombre" : crm.mode;
  const client = await avecCatalogue(api.crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, mode));
  const m = versMoteur(mail);
  return api.verrou.sous(cleVerrou(api, m, conf, mail.id), async () => {
    const lecture = await G.optionsLecture(api).catch(() => ({}));
    const d = await api.leads.traiter(m, client, conf, { dossiers: { trouver: fil.trouver }, ...lecture });

    if (d.dossier && d.portail)
      d.dossier.portail = d.portail;

    d.execution = { ...(await api.leads.executer(d, client, { mode, ecrireAVerifier: R && R.crm_a_verifier === true })), mode };
    if (client.notees) d.execution.ecritures_notees = client.notees.map(sansCommentaire);
    /* un mail « à trier » ne crée pas de dossier ; il peut en compléter un */
    const garder = d.dossier && !(d.statut === "a_trier" && !d.dossier.existant);
    const dossierId = garder ? await fil.enregistrer(api)(d, d.execution, new Date(mail.date_envoi || Date.now()), mail.id) : null;
    const id = await enregistrer(d, mail, dossierId);
    return { id, dossier_id: dossierId, statut: d.statut, dossier: d };
  });
};

const retraiter = (mailId, o) => traiterMail(mailId, o);

module.exports = { enregistrer, retraiter, traiterMail, versLigne, versMoteur, cleVerrou, champsLus };
