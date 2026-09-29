/* Le traitement d'un mail en étapes visibles (un bloc de workflow chacune) :
   préparer → (verrou du prospect) → lire → bien → contact → consentement → destinataires
   → écrire dans le CRM → enregistrer → (verrou rendu).
   Chaque étape reçoit le dossier rendu par la précédente ({{dossier}}) et le complète.
   Le moteur (dysizz-flow, lib/leads) est le même que pour « traiter en un bloc » : même résultat. */
"use strict";
const { nom } = require("./schema");
const { charger } = require("./conf");
const { flowApi } = require("./core");
const fil = require("./fil");
const { avecCatalogue } = require("./catalogue");
const G = require("./gabarits");
const { enregistrer, versMoteur, cleVerrou } = require("./dossier");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const api = () => {
  const a = flowApi();
  return a;
};
const obj = (v, nom = "dossier") => {
  if (v && typeof v === "object") return v;
  try { return JSON.parse(v); } catch (e) { throw perm(`${nom} : il faut le résultat de l'étape précédente ({{dossier}})`); }
};
const lireMail = async (id) => {
  const Table = require("@saltcorn/data/models/table");
  const t = Table.findOne({ name: nom("mails") });
  const m = t && (await t.getRow({ id: +id }));
  if (!m) throw perm(`mail ${id} introuvable dans ${nom("mails")}`);
  return m;
};
const clientCrm = async (crm, mode) => avecCatalogue(api().crmDepuisCoffre(crm.type, crm.reglages, crm.prefixe, mode));

/* Préparer : quel mail, quel mode, et la clé du verrou (la personne qui écrit). */
const preparer = async (id, { forcerOmbre = false } = {}) => {
  const a = api();
  const mail = await lireMail(id);
  const { conf, crm } = await charger();
  return { mail_id: mail.id, objet: String(mail.objet || "").slice(0, 200), cle: cleVerrou(a, versMoteur(mail), conf, mail.id), mode: forcerOmbre ? "ombre" : crm.mode, prefixe: require("./schema").prefixe() };
};

/* Lire : règles → gabarits appris → IA ; fil de conversation et dossiers déjà connus du prospect. */
const lire = async (lead) => {
  const a = api(), L = obj(lead, "lead");
  const mail = await lireMail(L.mail_id);
  const { conf } = await charger();
  const lecture = await G.optionsLecture(a).catch(() => ({}));
  const d = await a.leads.etapeLire(versMoteur(mail), conf, { dossiers: { trouver: fil.trouver }, ...lecture });
  return { ...d, mail_id: mail.id, mode: L.mode || "ombre", prefixe: L.prefixe || require("./schema").prefixe() };
};

/* Bien et contact : le CRM n'est que lu (catalogue local d'abord). */
const bien = async (dossier) => {
  const d = obj(dossier); if (d.fin) return d;
  const { conf, crm } = await charger();
  return api().leads.etapeBien(d, await clientCrm(crm, "ombre"), conf);
};
const contact = async (dossier) => {
  const d = obj(dossier); if (d.fin) return d;
  const { conf, crm } = await charger();
  return api().leads.etapeContact(d, await clientCrm(crm, "ombre"), conf);
};
const consentement = async (dossier) => {
  const d = obj(dossier); if (d.fin) return d;
  const { conf } = await charger();
  return api().leads.etapeConsentement(d, versMoteur(await lireMail(d.mail_id)), conf);
};
const destinataires = async (dossier) => {
  const d = obj(dossier); if (d.fin) return d;
  const { conf } = await charger();
  return api().leads.etapeDestinataires(d, conf);
};

/* Écrire dans le CRM : le plan est exécuté selon le mode (ombre : noté, rien d'écrit). */
const ecrireCrm = async (dossier) => {
  const a = api(), d = obj(dossier);
  const { crm } = await charger();
  const mode = d.mode === "reel" && crm.mode === "reel" ? "reel" : "ombre";
  const client = await clientCrm(crm, mode);
  if (d.dossier && d.portail) d.dossier.portail = d.portail;
  d.execution = { ...(await a.leads.executer(d, client, { mode })), mode };
  if (client.notees) d.execution.ecritures_notees = client.notees.map((x) => (x && x.donnees && x.donnees.comment ? { ...x, donnees: { ...x.donnees, comment: `(${x.donnees.comment.length} caractères)` } } : x));
  return d;
};

/* Enregistrer : le dossier (ld_dossiers, conversation dans ld_evenements) et le lead (ld_leads). */
const ranger = async (dossier) => {
  const a = api(), d = obj(dossier);
  const mail = await lireMail(d.mail_id);
  /* un mail « à trier » ne crée pas de dossier ; il peut en compléter un */
  const garder = d.dossier && !(d.statut === "a_trier" && !d.dossier.existant);
  const dossierId = garder ? await fil.enregistrer(a)(d, d.execution || {}, new Date(mail.date_envoi || Date.now()), mail.id) : null;
  const propre = a.leads.nettoyer({ ...d });
  delete propre.mail_id; delete propre.mode; delete propre.prefixe;
  const id = await enregistrer(propre, mail, dossierId);
  return { id, dossier_id: dossierId, statut: d.statut };
};

module.exports = { preparer, lire, bien, contact, consentement, destinataires, ecrireCrm, ranger };
