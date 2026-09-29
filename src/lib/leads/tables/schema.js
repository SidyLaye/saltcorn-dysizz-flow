/* Tables de la plateforme (préfixe ld_). Création idempotente : une table ou
   un champ manquant est ajouté, rien n'est jamais vidé ni modifié.
   Multi-clients : chaque client est un tenant Saltcorn (schéma Postgres séparé). */
"use strict";

const T = {
  reglages: { name: "ld_reglages", desc: "Réglages du client (une seule ligne)", fields: [
    ["crm", "String"], ["crm_reglages", "String"], ["prefixe_secrets", "String"], ["mode", "String"], ["envoi_mails", "Bool"],
    ["consentement_actif", "Bool"], ["consentement_libelle", "String"], ["utiliser_relais", "Bool"],
    ["domaines_agence", "String"], ["sites", "String"], ["objets_campagnes", "String"], ["id_crm_liens", "String"], ["origines_portail", "String"],
    ["boite_ecouteur", "String"], ["maj_le", "Date"],
    ["etapes", "String"], ["notifier_relances", "String"], ["marges_projet", "String"], ["commentaire_max", "Integer"], ["retention_jours", "Integer"],
    ["action_lead", "String"], ["catalogue_synchro_le", "Date"], ["catalogue_etat", "String"],
    ["ia_actif", "Bool"], ["ia_fournisseur", "String"], ["ia_modele", "String"], ["ia_plafond_jour", "Integer"], ["ia_url", "String"], ["gabarits_partages", "Bool"],
    ["lien_fiche", "String"], ["envoi_a_verifier", "Bool"]] },
  agences: { name: "ld_agences", desc: "Agences", fields: [["nom", "String", { required: true }], ["crm_id", "String"], ["boites", "String"], ["negociateur_defaut", "String"], ["actif", "Bool"], ["enseigne", "String"]] },
  personnes: { name: "ld_personnes", desc: "Négociateurs et assistant(e)s", fields: [
    ["nom", "String", { required: true }], ["email", "String"], ["role", "String"], ["crm_id", "String"], ["agence_crm_id", "String"],
    ["assistante", "Integer"], ["temps", "String"], ["jours", "String"], ["remplacant_hors_jours", "String"], ["telephone", "String"], ["actif", "Bool"], ["alias", "String"],
    ["groupe", "Integer"], ["remplacant_inactif", "String"], ["remarque", "String"], ["email_valide", "Bool"], ["alias_boite", "String"], ["statut_crm", "String"]] },
  regles: { name: "ld_regles_envoi", desc: "Règles d'envoi par négociateur ou groupe", fields: [
    ["libelle", "String", { required: true }], ["tous", "Bool"], ["negociateurs", "String"], ["couper_negociateur", "Bool"], ["assistante", "String"],
    ["assistante_remplacante", "String"], ["adresses_libres", "String"], ["actif", "Bool"], ["maj_le", "Date"], ["agence", "String"], ["groupe", "Integer"]] },
  absences: { name: "ld_absences", desc: "Congés et absences", fields: [["personne", "Integer", { required: true }], ["debut", "String", { required: true }], ["fin", "String"], ["remplacant", "String"], ["motif", "String"], ["note", "String"], ["actif", "Bool"]] },
  origines: { name: "ld_origines", desc: "Origines du CRM (portails, sites)", fields: [["code", "String", { required: true }], ["libelle", "String"], ["crm_id", "String"]] },
  siege: { name: "ld_siege", desc: "Adresses en copie : de tout (portée « tous ») ou d'une agence, d'un groupe, de personnes choisies", fields: [["email", "String", { required: true }], ["libelle", "String"], ["actif", "Bool"],
    ["portee", "String"], ["agence", "String"], ["groupe", "Integer"], ["personnes", "String"]] },
  groupes: { name: "ld_groupes", desc: "Groupes de personnes (secteur, équipe)", fields: [["nom", "String", { required: true }], ["description", "String"]] },
  leads: { name: "ld_leads", desc: "Leads traités (un par mail)", fields: [
    ["mail_id", "Integer"], ["message_id", "String"], ["recu_le", "Date"], ["traite_le", "Date"], ["expediteur", "String"], ["objet", "String"],
    ["portail", "String"], ["source", "String"], ["nature", "String"], ["statut", "String"], ["decision", "String"],
    ["contact_nom", "String"], ["contact_email", "String"], ["contact_tel", "String"], ["contact_crm", "String"], ["contact_action", "String"],
    ["reference", "String"], ["bien_crm", "String"], ["bien_ref_crm", "String"], ["bien_methode", "String"], ["bien_confiance", "String"],
    ["agence", "String"], ["negociateur", "String"], ["origine", "String"], ["site", "String"], ["destinataires", "String"],
    ["motifs", "String"], ["alertes", "String"], ["mode", "String"], ["actions", "String"], ["dossier", "String"], ["duree_ms", "Integer"],
    ["ancien_statut", "String"], ["ancien_bien", "String"], ["ancien_destinataires", "String"], ["dossier_id", "Integer"], ["role", "String"], ["lu_par", "String"],
    ["decision_le", "Date"], ["decision_par", "String"], ["envoi", "String"]] },
  dossiers: { name: "ld_dossiers", desc: "Dossiers (un prospect × un bien)", index: ["email", "relais", "tel9", "bien_crm"], fields: [
    ["relais", "String"], ["email", "String"], ["telephone", "String"], ["tel9", "String"], ["reference", "String"], ["bien_crm", "String"], ["bien_ref", "String"],
    ["contact_crm", "String"], ["recherche_crm", "String"], ["consentement", "Bool"], ["negociateur", "String"], ["agence", "String"], ["portail", "String"], ["nom", "String"],
    ["statut", "String"], ["premiere_demande", "Date"], ["reponse_le", "Date"], ["derniere_activite", "Date"], ["nb_mails", "Integer"], ["cree_le", "Date"], ["maj_le", "Date"]] },
  evenements: { name: "ld_evenements", desc: "Messages des dossiers (conversation)", index: ["dossier"], fields: [
    ["dossier", "Integer", { required: true }], ["mail_id", "Integer"], ["type", "String"], ["role", "String"], ["auteur", "String"], ["via", "String"], ["quand", "Date"], ["texte", "String"], ["source", "String"], ["empreinte", "String"]] },
  biens: { name: "ld_biens", desc: "Catalogue local des biens du CRM (synchronisé)", index: ["crm_id", "reference"], fields: [
    ["crm_id", "String", { required: true }], ["reference", "String"], ["prix", "Float"], ["surface", "Float"], ["pieces", "Integer"], ["chambres", "Integer"], ["type", "String"],
    ["ville", "String"], ["code_postal", "String"], ["negociateur", "String"], ["agence", "String"], ["proprietaire", "String"], ["supprime", "Bool"], ["synchro_le", "Date"],
    ["adresse", "String"], ["statut_web", "String"], ["photo_url", "String"]] },
  portails: { name: "ld_portails", desc: "Portails déclarés par le client (sans code)", fields: [
    ["nom", "String", { required: true }], ["domaines", "String"], ["objets_lead", "String"], ["objets_non_lead", "String"], ["libelles", "String"], ["reference", "String"], ["nature", "String"], ["actif", "Bool"]] },
  gabarits: { name: "ld_gabarits", desc: "Gabarits de mails appris automatiquement (forme d'un type de mail, sans donnée personnelle)", index: ["statut"], fields: [
    ["source", "String"], ["nature", "String"], ["signature", "String"], ["champs", "String"], ["statut", "String"], ["nb_observations", "Integer"], ["nb_echecs", "Integer"],
    ["nb_utilisations", "Integer"], ["origine", "String"], ["cree_le", "Date"], ["vu_le", "Date"], ["active_le", "Date"], ["suspendu_le", "Date"]] },
  ia: { name: "ld_ia", desc: "Appels à l'IA (pour le plafond et le suivi des coûts)", index: ["quand"], fields: [
    ["quand", "Date"], ["ok", "Bool"], ["ms", "Integer"], ["nature", "String"], ["source", "String"], ["erreur", "String"]] },
  demandes: { name: "ld_demandes", desc: "Demandes d'évolution et incidents", fields: [
    ["titre", "String", { required: true }], ["description", "String"], ["urgence", "String"], ["statut", "String"], ["demandeur", "String"], ["cree_le", "Date"], ["maj_le", "Date"]] },
  champs: { name: "ld_champs", desc: "Chaque valeur lue dans un mail et d'où elle vient", index: ["lead"], fields: [
    ["lead", "Integer", { required: true }], ["champ", "String"], ["valeur", "String"], ["provenance", "String"]] },
  messages: { name: "ld_demande_messages", desc: "Messages des demandes", fields: [["demande", "Integer", { required: true }], ["auteur", "String"], ["admin", "Bool"], ["texte", "String"], ["quand", "Date"]] },
  etapes: { name: "ld_demande_etapes", desc: "Historique des demandes", fields: [["demande", "Integer", { required: true }], ["statut", "String"], ["quand", "Date"], ["note", "String"], ["par", "String"]] },
};

const STATUTS_DEMANDE = ["Reçue", "Prise en compte", "En cours de traitement", "Terminée", "Mise en ligne"];
const URGENCES = { Bloquant: "alerte immédiate", Important: "dans la journée", Confort: "file normale" };
/* Noms des tables : préfixe réglable (« ld_ » par défaut) ; chaque bloc Leads l'exécute dans son préfixe.
   Ainsi deux applications d'un même tenant (ou un autre client) peuvent avoir leurs propres tables. */
const { AsyncLocalStorage } = require("async_hooks");
const ALS = globalThis[Symbol.for("dysizz-flow.leads.prefixe")] || (globalThis[Symbol.for("dysizz-flow.leads.prefixe")] = new AsyncLocalStorage());
const PREFIXE = "ld_";
const prefixe = () => { const p = ALS.getStore(); return p && /^[a-z][a-z0-9_]{0,20}$/.test(p) ? p : PREFIXE; };
const nom = (k) => prefixe() + (k === "mails" ? "mails" : T[k].name.replace(/^ld_/, ""));
const avecPrefixe = (p, fn) => ALS.run(p && /^[a-z][a-z0-9_]{0,20}$/.test(String(p)) ? String(p) : PREFIXE, fn);
/* le contrat de chaque table (champs attendus) sert à les créer ou compléter, jamais à rien supprimer */
const definitions = () => Object.entries(T).map(([k, d]) => ({ k, nom: nom(k), description: "Leads · " + d.desc, lecture: 40, ecriture: 40, champs: d.fields, index: d.index }));

const pret = new Map();
/* Tables existantes, complétées si un champ manque (mise à jour sans risque). Une table absente :
   erreur claire, sauf si « creer » (modèle du Catalogue, bloc « Leads : préparer les tables »). */
const ouvrir = async (creer) => {
  const { assurer } = require("../../structure");
  const Table = require("@saltcorn/data/models/table");
  const out = {}, manquantes = [];
  for (const d of definitions()) {
    if (!creer && !Table.findOne({ name: d.nom })) { manquantes.push(d.nom); continue; }
    out[d.k] = (await assurer(d)).t;
  }
  if (manquantes.length && ["reglages", "leads", "dossiers"].some((k) => manquantes.includes(nom(k))))
    throw Object.assign(new Error(`tables absentes : ${manquantes.join(", ")}. Installe le modèle « Leads immobiliers » du Catalogue, ou lance le bloc « Leads : préparer les tables ».`), { permanent: true });
  return out;
};
const tables = async () => {
  const key = require("@saltcorn/data/db").getTenantSchema() + ":" + prefixe();
  if (!pret.has(key)) pret.set(key, ouvrir(false).catch((e) => { pret.delete(key); throw e; }));
  return pret.get(key);
};
const preparer = async () => { await require("../../../ecouteurs").tableDest(nom("mails")); const r = await ouvrir(true); pret.delete(require("@saltcorn/data/db").getTenantSchema() + ":" + prefixe()); return Object.values(r).map((t) => t.name); };
module.exports = { T, tables, preparer, nom, prefixe, avecPrefixe, definitions, PREFIXE, STATUTS_DEMANDE, URGENCES };
