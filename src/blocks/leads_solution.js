/* Leads immobiliers sur des tables Saltcorn : le traitement d'un mail reçu, étape par étape.
   Blocs génériques : les tables portent un préfixe réglable (« ld_ » par défaut), créées par le modèle
   « Leads immobiliers » du Catalogue ou par le bloc « Leads : préparer les tables ». Chaque étape lit
   {{dossier}} et le rend complété. */
"use strict";
const E = require("../lib/leads/tables/etapes");
const S = require("../lib/leads/tables/schema");
const CAT = "Leads immobiliers";
const P_DOSSIER = { name: "dossier", label: "Dossier (étape précédente)", type: "json", default: "{{dossier}}" };
const P_PREFIXE = { name: "prefixe", label: "Préfixe des tables", default: "ld_", help: "ld_ → ld_mails, ld_leads, ld_personnes… (un autre préfixe = un autre jeu de tables)" };
const lu = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { return {}; } };
/* le préfixe vient du réglage du bloc, sinon du dossier ou du mail préparé */
const dans = (p, fn) => S.avecPrefixe(p.prefixe || lu(p.dossier).prefixe || lu(p.lead).prefixe, fn);
const etape = (name, label, icon, description, fn, timeout = 60) => ({ name, label, category: CAT, icon, output: "dossier", timeout, description, params: [P_DOSSIER], run: async (p) => dans(p, () => fn(p.dossier)) });

module.exports = [
  {
    name: "dzf_leads_tables", label: "Leads : préparer les tables", category: CAT, icon: "fas fa-table", output: "tables", timeout: 120,
    description: "Crée ou complète les tables des leads (réglages, agences, équipe, groupes, règles d'envoi, absences, copies, mails reçus, leads, valeurs lues, conversations, biens, gabarits, demandes). Ne supprime ni ne modifie rien : à relancer après une mise à jour.",
    params: [P_PREFIXE],
    run: async (p) => dans(p, async () => ({ tables: await S.preparer() })),
  },
  {
    name: "dzf_leads_preparer", label: "Leads : préparer le mail reçu", category: CAT, icon: "fas fa-inbox", output: "lead",
    description: "Prend le mail reçu, le mode (ombre ou réel) et la personne qui écrit : deux mails d'une même personne sont traités l'un après l'autre (verrou).",
    params: [{ name: "id", label: "Id du mail reçu", default: "{{id}}", required: true }, P_PREFIXE],
    run: async (p) => dans(p, () => E.preparer(+p.id)),
  },
  {
    name: "dzf_leads_lire", label: "Leads : lire le mail", category: CAT, icon: "fas fa-envelope-open-text", output: "dossier", timeout: 120,
    description: "Lit le mail en trois étages : règles des portails connus, gabarits appris tout seuls, IA en dernier recours (si réglée). Portail, nature (lead, relance, non-lead…), prospect, bien cité, message. Rattache le mail à la conversation du prospect. Un non-lead ou une réponse de l'équipe s'arrête ici.",
    params: [{ name: "lead", label: "Mail préparé", type: "json", default: "{{lead}}" }],
    run: async (p) => dans(p, () => E.lire(p.lead)),
  },
  etape("dzf_leads_bien", "Leads : retrouver le bien", "fas fa-search-location", "Catalogue local, puis CRM : identifiant, référence complète, référence moins le dernier caractère, segments, puis critères. Chaque bien trouvé est comparé au mail ; contradiction = rejet. Rattache le dossier existant du prospect pour ce bien.", E.bien, 90),
  etape("dzf_leads_contact", "Leads : agence, négociateur et contact", "fas fa-address-card", "Agence (bien, compte du portail, boîte qui a reçu, agence citée) ; négociateur du bien ; contact du CRM (e-mail d'abord, puis le plus récent ; on complète, on n'écrase pas) ; origine ; plan d'écriture dans le CRM (contact, suivi du bien, projet de recherche avec toute la conversation).", E.contact, 90),
  etape("dzf_leads_consentement", "Leads : consentement anti-démarchage", "fas fa-file-signature", "Ajoute au plan le consentement du prospect : date de la demande, motif « Demande de contact via <portail> du <date> » (réglable), et le mail d'origine (.eml) en preuve. Une seule fois par contact.", E.consentement),
  etape("dzf_leads_destinataires", "Leads : qui reçoit ?", "fas fa-user-check", "Négociateur du bien, assistant(e), règles d'envoi (personne, groupe, agence, tous), congés, mi-temps, départs, siège et copies ciblées. Une relance d'une conversation déjà suivie ne va qu'au négociateur (réglable). Donne aussi le statut : prêt, à vérifier, à trier.", E.destinataires),
  etape("dzf_leads_crm", "Leads : écrire dans le CRM", "fas fa-cloud-upload-alt", "Exécute le plan (contact, suivi du bien, projet de recherche, consentement) selon le mode : en ombre, rien n'est écrit, tout est noté. Chaque écriture est relue ; rejouer ne crée pas de doublon.", E.ecrireCrm, 120),
  {
    name: "dzf_leads_enregistrer", label: "Leads : enregistrer le lead et la conversation", category: CAT, icon: "fas fa-save", output: "resultat",
    description: "Range le lead, chaque valeur lue et sa provenance, le dossier du prospect et la conversation. Retraiter un mail met à jour les mêmes lignes.",
    params: [P_DOSSIER],
    run: async (p) => dans(p, () => E.ranger(p.dossier)),
  },
  {
    name: "dzf_leads_messages", label: "Leads : préparer les mails du lead", category: CAT, icon: "fas fa-envelope", output: "messages",
    description: "Un mail par destinataire (prospect, bien, agence, message, lien vers la fiche, pourquoi il le reçoit), prêt pour « Mail : envoyer une seule fois ». Rien pour un lead « à vérifier » (réglable). Envois coupés dans les réglages : simulés.",
    params: [P_DOSSIER, { name: "resultat", label: "Lead enregistré", type: "json", default: "{{resultat}}" }],
    run: async (p) => dans(p, () => require("../lib/leads/tables/envoi").messages(p.dossier, p.resultat)),
  },
  {
    name: "dzf_leads_traiter", label: "Leads : traiter un mail en un seul bloc", category: CAT, icon: "fas fa-bullseye", output: "lead", timeout: 180,
    description: "Toutes les étapes d'un coup (lecture, bien, contact, consentement, destinataires, CRM, enregistrement), sous le verrou du prospect. Pour retraiter un mail ; sans envoi.",
    params: [{ name: "id", label: "Id du mail reçu", default: "{{id}}", required: true }, P_PREFIXE, { name: "ombre", label: "Forcer le mode ombre", type: "bool" }],
    run: async (p) => dans(p, async () => { const r = await require("../lib/leads/tables/dossier").traiterMail(+p.id, { forcerOmbre: !!p.ombre }); return { id: r.id, dossier_id: r.dossier_id, statut: r.statut }; }),
  },
  {
    name: "dzf_leads_catalogue", label: "Leads : synchroniser le catalogue des biens", category: CAT, icon: "fas fa-sync", output: "catalogue", timeout: 600,
    description: "Recopie les biens du CRM dans la table des biens (complet la première fois, puis seulement les biens modifiés). Le rapprochement lit ce catalogue local, sans appeler le CRM à chaque mail.",
    params: [P_PREFIXE, { name: "complet", label: "Tout recopier", type: "bool" }],
    run: async (p) => dans(p, () => require("../lib/leads/tables/catalogue").synchroniser({ complet: !!p.complet })),
  },
  {
    name: "dzf_leads_importer_gabarits", label: "Leads : reprendre les gabarits d'un ancien système", category: CAT, icon: "fas fa-file-import", output: "gabarits", timeout: 120,
    description: "Recopie les gabarits de lecture actifs d'une table existante (ex. gabarit_version d'une ancienne automatisation) : les mails de ces formes sont lus tout de suite, sans IA. Une seule fois par gabarit ; rien n'est supprimé.",
    params: [P_PREFIXE, { name: "table", label: "Table des anciens gabarits", type: "table", default: "gabarit_version" }],
    run: async (p) => dans(p, async () => {
      const t = require("@saltcorn/data/models/table").findOne({ name: p.table || "gabarit_version" });
      if (!t) throw Object.assign(new Error(`table « ${p.table} » introuvable`), { permanent: true });
      const n = await require("../lib/leads/tables/gabarits").importerAmbs(require("../api"), await t.getRows({}));
      return { importes: n };
    }),
  },
  {
    name: "dzf_leads_entretien", label: "Leads : reprises et entretien", category: CAT, icon: "fas fa-broom", output: "entretien", timeout: 600,
    description: "Retraite les mails restés sans lead (panne, redémarrage), relit ceux laissés de côté faute de budget d'IA, efface le texte des vieux mails (durée de conservation réglée). À mettre dans un workflow horaire.",
    params: [P_PREFIXE],
    run: async (p) => dans(p, async () => {
      const T = require("../lib/leads/tables/taches");
      return { mails: await T.reprendreMails(), ia: await T.relireIA(), conservation: await T.retention() };
    }),
  },
];
