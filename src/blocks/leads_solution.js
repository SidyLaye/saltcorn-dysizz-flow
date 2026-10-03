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
    run: async (p) => dans(p, async () => {
      const R = require("../lib/rafraichir"), n0 = R.mises_de_cote.length;
      const tables = await S.preparer();
      return { tables, ...(R.mises_de_cote.length > n0 ? { mises_de_cote: R.mises_de_cote.slice(n0) } : {}) };
    }),
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
  etape("dzf_leads_conformite", "Leads : vérifier la conformité RGPD", "fas fa-file-signature", "Complète le RGPD après un contact CRM et un consentement confirmés. Relit la fiche après écriture ; ne rejoue ni le CRM ni les e-mails. Sans contact, étape sans effet.", E.conformite, 120),
  {
    name: "dzf_leads_integrer_conformite", label: "Leads : intégrer le correctif RGPD de l'atelier", category: CAT,
    icon: "fas fa-file-signature", description: "Sauvegarde et migre le bloc RGPD personnalisé connu vers le contrôle natif avec relecture. Refuse un code modifié ; aucun envoi.",
    output: "integration", params: [],
    run: async (_p, _ctx, api) => {
      if (!api.user || Number(api.user.role_id) !== 1) throw new Error("Administrateur requis");
      const { blocs, versions } = await require("../store").ensureTables();
      const old = await blocs.getRow({ nom: "leads_crm_conformite" });
      if (!old) return { modifie: false, motif: "aucun bloc personnalisé à migrer", emails_envoyes: 0 };
      const code = 'const r = await Actions.dzf_leads_conformite({ dossier: params.dossier });\nreturn r.dossier;';
      if (old.code === code) { await require("../userblocks").broadcast(); return { modifie: false, deja_corrige: true, emails_envoyes: 0 }; }
      const hash = require("crypto").createHash("sha256").update(String(old.code || "").replace(/\r/g, "")).digest("hex");
      if (hash !== "7105f65e0acf7352ff7340541fe82657d17f79ad16b6c3594802d7fb37e21596")
        throw new Error("Le bloc RGPD a changé depuis la sauvegarde : vérifier ce nouveau code avant migration");
      const sauvegarde = await versions.insertRow({ nom: old.nom, version: old.version || 1,
        contenu: JSON.stringify(old), quand: new Date(), par: "migration dysizz-flow 2.14.10" });
      await blocs.updateRow({ code, version: (old.version || 1) + 1, maj_le: new Date(),
        description: "Contrôle RGPD après CRM confirmé ; relecture obligatoire ; sans contact, étape sans effet." }, old.id);
      await require("../userblocks").broadcast();
      return { modifie: true, sauvegarde, version: (old.version || 1) + 1, emails_envoyes: 0 };
    },
  },
  {
    name: "dzf_leads_enregistrer", label: "Leads : enregistrer le lead et la conversation", category: CAT, icon: "fas fa-save", output: "resultat",
    description: "Range le lead, chaque valeur lue et sa provenance, le dossier du prospect et la conversation. Retraiter un mail met à jour les mêmes lignes.",
    params: [P_DOSSIER],
    run: async (p) => dans(p, () => E.ranger(p.dossier)),
  },
  {
    name: "dzf_leads_messages", label: "Leads : préparer les mails du lead", category: CAT, icon: "fas fa-envelope", output: "messages",
    description: "Un mail par destinataire, prêt pour « Mail : envoyer une seule fois » : la fiche du lead, ou le mail reçu tel quel avec son objet d'origine (réglage « format_envoi »). Un lead qui ne peut pas être automatisé (bien, agence ou négociateur introuvable…) est transféré tel quel à l'adresse « non automatisé » des réglages. Envois coupés dans les réglages : simulés.",
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
    name: "dzf_leads_recevoir", label: "Leads : recevoir un mail rangé par un autre système", category: CAT, icon: "fas fa-inbox", output: "recu", timeout: 60,
    description: "Recopie un mail déjà rangé dans une autre table (ex. celle d'un ancien système qui lit la même boîte) dans la table des mails reçus, puis lance le traitement (comme l'écouteur : événement DzfMailRecu). Sert à faire tourner la solution à côté d'un ancien système, sans se connecter une deuxième fois à la boîte. À mettre dans un déclencheur « Insert » sur la table source. Un mail n'est jamais recopié deux fois.",
    params: [P_PREFIXE, { name: "table", label: "Table source", type: "table", required: true }, { name: "id", label: "Id du mail dans la table source", default: "{{id}}", required: true },
      { name: "champs", label: "Champs de la table source (JSON)", type: "json", help: "Vide = mêmes noms (expediteur, destinataire, objet, corps_texte, corps_html, date_envoi, message_id, uid). Ex. {\"objet\":\"sujet\"}" },
      { name: "ecouteur", label: "Nom de l'écouteur (canal du workflow)", default: "leads" }],
    run: async (p) => dans(p, async () => {
      const Table = require("@saltcorn/data/models/table");
      const src = Table.findOne({ name: p.table });
      if (!src) throw Object.assign(new Error(`table « ${p.table} » introuvable`), { permanent: true });
      const r = await src.getRow({ id: +p.id });
      if (!r) throw Object.assign(new Error(`mail ${p.id} introuvable dans ${p.table}`), { permanent: true });
      const c = { expediteur: "expediteur", destinataire: "destinataire", objet: "objet", corps_texte: "corps_texte", corps_html: "corps_html", date_envoi: "date_envoi", message_id: "message_id", uid: "uid", ...lu(p.champs) };
      const v = (k) => (c[k] && r[c[k]] !== undefined ? r[c[k]] : null);
      const message_id = String(v("message_id") || `${p.table}:${r.id}`);
      const t = await require("../ecouteurs").tableDest(S.nom("mails"));
      const deja = (await t.getRows({ message_id }, { limit: 1 }))[0];
      if (deja) return { id: deja.id, nouveau: false };
      const id = await t.insertRow({ uid: Number.isFinite(+v("uid")) && v("uid") !== null ? +v("uid") : null, dossier: "INBOX", message_id, expediteur: v("expediteur"), destinataire: v("destinataire"), objet: v("objet"),
        date_envoi: v("date_envoi"), corps_texte: v("corps_texte"), corps_html: v("corps_html"), recu_le: new Date(), ecouteur: p.ecouteur || "leads" });
      const Trigger = require("@saltcorn/data/models/trigger");
      await Trigger.emitEvent("DzfMailRecu", p.ecouteur || "leads", null, { id, table: S.nom("mails") });
      return { id, nouveau: true };
    }),
  },
  {
    name: "dzf_leads_rattraper_crm", label: "Leads : reprendre les écritures CRM en échec", category: CAT,
    icon: "fas fa-redo", output: "reprise", timeout: 60,
    description: "Retraite en arrière-plan les mails d'une période dont la dernière exécution garde une erreur CRM. Réutilise la pipeline Leads et les mêmes lignes ; n'envoie aucun e-mail. Rapport dans Fichiers.",
    params: [P_PREFIXE,
      { name: "debut", label: "Début ISO inclus (avec fuseau)", type: "String", required: true },
      { name: "fin", label: "Fin ISO exclue (vide = maintenant)", type: "String" },
      { name: "fichier", label: "Rapport", default: "rattrapage-crm.json" }],
    run: async (p, ctx = {}) => dans(p, async () => {
      const nom = String(p.fichier || "rattrapage-crm.json").replace(/[^\w.-]/g, "_");
      return require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_rattraper_crm", nom, async (suivi) => {
        const rapport = await require("../lib/leads/tables/reprise_crm").rattraperCrm({ debut: p.debut, fin: p.fin, suivi });
        const File = require("@saltcorn/data/models/file");
        await File.from_contents(nom, "application/json", JSON.stringify(rapport, null, 1), ctx.user && ctx.user.id, 1);
        return { fichier: nom, ...rapport };
      });
    }),
  },
  {
    name: "dzf_leads_reparer_crm", label: "Leads : vérifier puis réparer contacts et consentements", category: CAT,
    icon: "fas fa-check-double", output: "reparation", timeout: 60,
    description: "Production : reprend le dernier lead avec le motif actuel, confirme dans Immofacile, puis reprend la période seulement si le contrôle réussit. Aucun envoi d'e-mail.",
    params: [P_PREFIXE,
      { name: "debut", label: "Début ISO inclus", type: "String", required: true },
      { name: "fin", label: "Fin ISO exclue (vide = maintenant)", type: "String" },
      { name: "fichier", label: "Rapport", default: "reparation-crm.json" },
      { name: "recalcul_vues", label: "Recalculer les vues AMBS après la réparation", type: "bool" },
      { name: "reprise_auto", label: "Activer la reprise horaire des échecs CRM", type: "bool" }],
    run: async (p, ctx = {}, api) => {
      if (!api || !api.user || api.user.role_id !== 1) throw new Error("réservé aux administrateurs");
      return dans(p, async () => {
        const nom = String(p.fichier || "reparation-crm.json").replace(/[^\w.-]/g, "_");
        return require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_reparer_crm", nom, async (suivi) => {
          const rapport = await require("../lib/leads/tables/reprise_crm").reparerCrm({ debut: p.debut, fin: p.fin, suivi });
          if (rapport.poursuite_autorisee && p.reprise_auto) {
            const Trigger = require("@saltcorn/data/models/trigger");
            const existant = await Trigger.findOne({ name: "ambs_reprise_crm_heure" });
            if (existant && (existant.action !== "dzf_leads_reprendre_crm" || existant.when_trigger !== "Hourly"))
              throw new Error("Le déclencheur ambs_reprise_crm_heure existe avec une autre configuration");
            if (!existant) await Trigger.create({ name: "ambs_reprise_crm_heure", action: "dzf_leads_reprendre_crm",
              when_trigger: "Hourly", configuration: {}, min_role: 1,
              description: "Reprend les échecs CRM confirmés des leads récents, sans envoi d'e-mail" });
            rapport.reprise_auto = true;
          }
          if (p.recalcul_vues) rapport.vues = await require("../lib/leads/tables/reprise_vues").rafraichirVues({
            workflow: "ambs_lecture", etapes: "vue_lead,vue_bien,vue_agence,vue_nego", suivi, api });
          rapport.termine = true;
          rapport.termine_le = new Date().toISOString();
          const File = require("@saltcorn/data/models/file");
          await File.from_contents(nom, "application/json", JSON.stringify(rapport, null, 1), api.user.id, 1);
          return { fichier: nom, ...rapport };
        });
      });
    },
  },
  {
    name: "dzf_leads_reaffecter_periode", label: "Leads : corriger les affectations CRM d'une période", category: CAT,
    icon: "fas fa-user-tag", output: "reaffectation", timeout: 60,
    description: "Dernière demande avec bien par contact, négociateur actuel du bien, contrôle d'identité et relecture. Reprise sauvegardée ; aucun e-mail ni rejeu de pipeline.",
    params: [P_PREFIXE, { name: "debut", label: "Début ISO inclus", required: true },
      { name: "fichier", label: "Rapport", default: "reaffectation-crm.json" }],
    run: async (p, ctx = {}, api) => {
      if (!api.user || Number(api.user.role_id) !== 1) throw new Error("Administrateur requis");
      return dans(p, () => require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_reaffecter_periode",
        String(p.fichier || "reaffectation-crm.json").replace(/[^\w.-]/g, "_"), async suivi => {
          const rapport = await require("../lib/leads/tables/reaffectation").reaffecter({ debut: p.debut, suivi });
          const fichier = String(p.fichier || "reaffectation-crm.json").replace(/[^\w.-]/g, "_");
          await require("@saltcorn/data/models/file").from_contents(fichier, "application/json", JSON.stringify(rapport,null,1), api.user.id, 1);
          return { fichier, ...rapport };
        }));
    },
  },
  {
    name: "dzf_leads_reparer_selection_crm", label: "Leads : réparer une sélection de fiches CRM", category: CAT,
    icon: "fas fa-user-check", output: "reparation_selection", timeout: 60,
    description: "Reprend uniquement les leads choisis, avec contrôle du contact et du consentement dans Immofacile. Arrière-plan, rapport final, aucun e-mail.",
    params: [P_PREFIXE, { name: "ids", label: "Identifiants des leads (JSON)", type: "json", required: true },
      { name: "fichier", label: "Rapport", default: "reparation-selection-crm.json" },
      { name: "actualiser_motif", label: "Remplacer aussi le motif d'un consentement déjà présent", type: "bool", default: true },
      { name: "recalcul_vues", label: "Recalculer les vues AMBS après la reprise", type: "bool" }],
    run: async (p, ctx = {}, api) => {
      if (!api || !api.user || api.user.role_id !== 1) throw new Error("réservé aux administrateurs");
      return dans(p, () => {
        const nom = String(p.fichier || "reparation-selection-crm.json").replace(/[^\w.-]/g, "_");
        return require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_reparer_selection_crm", nom, async (suivi) => {
          const rapport = await require("../lib/leads/tables/reprise_crm").reparerSelection({ ids: p.ids, suivi, actualiserConsentement: p.actualiser_motif !== false });
          if (p.recalcul_vues) rapport.vues = await require("../lib/leads/tables/reprise_vues").rafraichirVues({
            workflow: "ambs_lecture", etapes: "vue_lead,vue_bien,vue_agence,vue_nego", suivi, api });
          rapport.termine = true;
          rapport.termine_le = new Date().toISOString();
          await require("@saltcorn/data/models/file").from_contents(nom, "application/json", JSON.stringify(rapport,null,1), api.user.id, 1);
          return { fichier: nom, ...rapport };
        });
      });
    },
  },
  {
    name: "dzf_leads_reprendre_crm", label: "Leads : reprendre les échecs CRM récents", category: CAT,
    icon: "fas fa-redo", output: "reprise_crm", timeout: 60,
    description: "Reprise horaire en arrière-plan des erreurs CRM confirmées, avec rotation de 25 dossiers. Aucun e-mail ni nouvelle tentative d'écriture ambiguë.",
    params: [P_PREFIXE],
    run: async (p, ctx = {}) => dans(p, () => require("../lib/arriere_plan").enFond(p, ctx,
      "dzf_leads_reprendre_crm", "reprise-crm-automatique.json", async () => {
        const rapport = await require("../lib/leads/tables/taches").reprendreCrm();
        if (rapport.candidats) {
          const File = require("@saltcorn/data/models/file");
          await File.from_contents("reprise-crm-automatique.json", "application/json", JSON.stringify(rapport,null,1), ctx.user && ctx.user.id, 1);
        }
        return rapport;
      })),
  },
  {
    name: "dzf_leads_rafraichir_vues", label: "Leads : recalculer les vues de lecture", category: CAT,
    icon: "fas fa-layer-group", output: "reprise", timeout: 60,
    description: "Recalcule en arrière-plan, dans l'ordre, les tables de lecture d'un workflow déjà configuré. Ne traite aucun mail et n'envoie rien. Rapport dans Fichiers.",
    params: [
      { name: "workflow", label: "Nom du déclencheur de lecture", default: "ambs_lecture", required: true },
      { name: "etapes", label: "Étapes dans l'ordre, séparées par des virgules", default: "vue_lead,vue_bien,vue_agence,vue_nego", required: true },
      { name: "fichier", label: "Rapport", default: "recalcul-vues.json" },
    ],
    run: async (p, ctx = {}, api) => {
      if (!api || !api.user || api.user.role_id !== 1) throw new Error("réservé aux administrateurs");
      const nom = String(p.fichier || "recalcul-vues.json").replace(/[^\w.-]/g, "_");
      return require("../lib/arriere_plan").enFond(p, ctx, "dzf_leads_rafraichir_vues", nom, async (suivi) => {
        const rapport = await require("../lib/leads/tables/reprise_vues").rafraichirVues({
          workflow: p.workflow, etapes: p.etapes, suivi, api,
        });
        const File = require("@saltcorn/data/models/file");
        await File.from_contents(nom, "application/json", JSON.stringify(rapport, null, 1), api.user.id, 1);
        return { fichier: nom, ...rapport };
      });
    },
  },
  {
    name: "dzf_leads_entretien", label: "Leads : reprises et entretien", category: CAT, icon: "fas fa-broom", output: "entretien", timeout: 600,
    description: "Retraite les mails restés sans lead (panne, redémarrage), relit ceux laissés de côté faute de budget d'IA, efface le texte des vieux mails (durée de conservation réglée). À mettre dans un workflow horaire.",
    params: [P_PREFIXE],
    run: async (p) => dans(p, async () => {
      const T = require("../lib/leads/tables/taches");
      return { mails: await T.reprendreMails(), crm: await T.reprendreCrm(), ia: await T.relireIA(), conservation: await T.retention() };
    }),
  },
];
