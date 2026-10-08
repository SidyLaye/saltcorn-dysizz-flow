/* Famille « Leads immobiliers » : du mail de portail au bon négociateur.
   Moteur déterministe (lib/leads) : lecture des mails de 30 portails, rapprochement
   du bien (référence, variantes, critères), contact (priorité e-mail puis le plus
   récent), consentement, destinataires (règles d'envoi, congés, mi-temps).
   CRM au choix : Immofacile, Salesforce, ou mémoire (essais). Mode ombre par défaut. */
"use strict";
const { extraire } = require("../lib/leads/extraire");
const { rapprocher } = require("../lib/leads/rapprochement");
const { traiter, executer } = require("../lib/leads/traiter");
const { destinataires, absentsSemaine } = require("../lib/leads/routage");
const { lireRoutage } = require("../lib/leads/routage-tables");
const { creerCrm, ADAPTATEURS } = require("../lib/leads/crm");
const { PORTAILS } = require("../lib/leads/portails");

const perm = (m) => Object.assign(new Error(m), { permanent: true });
const obj = (v, nom) => { if (v === undefined || v === null || v === "") return {}; if (typeof v === "object") return v; try { return JSON.parse(v); } catch (e) { throw perm(`${nom} : JSON invalide`); } };
const versMail = (m) => {
  const x = obj(m, "mail");
  return { expediteur: x.expediteur ?? x.de ?? x.from ?? "", destinataire: x.destinataire ?? x.a ?? x.to ?? "", objet: x.objet ?? x.sujet ?? x.subject ?? "", texte: x.corps_texte ?? x.corps ?? x.texte ?? x.text ?? "", html: x.corps_html ?? x.html ?? "", date: x.date_envoi ?? x.date ?? new Date() };
};
const P_CONF = { name: "configuration", label: "Configuration", type: "json", default: "{{leads_conf}}", help: "Agences, personnes, règles, absences, origines, sites… (bloc « Leads : charger la configuration » de la solution, ou un JSON)" };
const P_CRM = [
  { name: "crm", label: "CRM", type: "select", options: Object.keys(ADAPTATEURS), default: "immofacile" },
  { name: "crm_reglages", label: "Réglages du CRM", type: "json", default: "{}", help: 'Immofacile : {"site_id":"…"}. Salesforce : {"domaine":"https://….my.salesforce.com", "contact":{"objet":"Lead"}}' },
  { name: "prefixe_secrets", label: "Préfixe des secrets", default: "LEADS_CRM", help: "Immofacile : LEADS_CRM_BASIC. Salesforce : LEADS_CRM_CLIENT_ID, LEADS_CRM_CLIENT_SECRET (+ LEADS_CRM_REFRESH_TOKEN)." },
];
/* règles d'envoi : un JSON (configuration de la solution) ou lues dans les tables de l'équipe */
const P_ROUTAGE = { name: "routage", label: "Règles d'envoi", type: "json", default: "{{leads_conf.routage}}", help: "JSON, ou \"tables\" (avec les guillemets) pour les lire dans equipe, absence, regle_envoi et destinataire_custom" };
const P_TABLES = { name: "tables", label: "Noms des tables (si « tables »)", type: "json", default: "{}", help: '{"equipe":"equipe","absence":"absence","regle":"regle_envoi","copies":"destinataire_custom"}' };
const routageDe = async (p) => (p.routage === "tables" || p.routage === '"tables"' ? lireRoutage(obj(p.tables, "tables")) : obj(p.routage, "routage"));
const crmDe = (p, api, mode = "ombre") => {
  const reg = obj(p.crm_reglages, "réglages du CRM");
  const pre = String(p.prefixe_secrets || "LEADS_CRM").replace(/[^\w]/g, "");
  return creerCrm(p.crm, { ...reg, secret: (k) => api.secret(`${pre}_${String(k).toUpperCase()}`) }, { mode });
};

module.exports = [
  {
    name: "dzf_lead_extraire", label: "Leads : lire un mail de portail", category: "Leads immobiliers", icon: "fas fa-envelope-open-text", output: "lead",
    description: `Lit un mail de lead sans IA : portail, nature (lead, relance, estimation, non-lead…), contact, bien (référence, prix, surface, pièces, ville), message, site d'agence d'origine. Chaque champ dit d'où il vient. ${PORTAILS.length} portails reconnus.`,
    params: [{ name: "mail", label: "Mail", type: "json", default: "{{row}}", help: "Objet avec expediteur, destinataire, objet, corps_texte, corps_html, date_envoi" }, P_CONF],
    run: async (p) => extraire(versMail(p.mail), obj(p.configuration, "configuration")),
  },
  {
    name: "dzf_lead_traiter", label: "Leads : traiter un mail", category: "Leads immobiliers", icon: "fas fa-route", output: "dossier", timeout: 120,
    description: "Traitement complet : lecture, bien, agence, négociateur, contact, consentement, destinataires. En mode ombre, le CRM est seulement lu et les écritures sont notées. Aucun mail n'est envoyé par ce bloc.",
    params: [{ name: "mail", label: "Mail", type: "json", default: "{{row}}" }, P_CONF, ...P_CRM,
      { name: "mode", label: "Mode", type: "select", options: ["ombre", "reel"], default: "ombre", help: "ombre : aucune écriture dans le CRM. reel : crée / complète le contact, lie le bien, pose le consentement." }],
    run: async (p, ctx, api) => {
      const crm = crmDe(p, api, p.mode);
      const conf = obj(p.configuration, "configuration");
      const d = await traiter(versMail(p.mail), crm, conf);
      d.execution = await executer(d, crm, { mode: p.mode });
      if (crm.notees) d.execution.ecritures_notees = crm.notees;
      return d;
    },
  },
  {
    name: "dzf_lead_rapprocher", label: "Leads : retrouver le bien", category: "Leads immobiliers", icon: "fas fa-search-location", output: "rapprochement", timeout: 90,
    description: "Retrouve le bien dans le CRM : identifiant, référence complète, référence moins le dernier caractère, segments de droite à gauche, puis critères un par un. Chaque bien trouvé est comparé au mail (prix, ville, code postal, surface, pièces) ; contradiction = rejet.",
    params: [{ name: "bien", label: "Infos du bien (depuis le mail)", type: "json", default: "{{lead.bien}}", help: '{"reference":"32102","prix":240000,"surface":105,"pieces":5,"ville":"Cardaillac","code_postal":"46100"}' }, ...P_CRM],
    run: async (p, ctx, api) => rapprocher({ bien: obj(p.bien, "bien") }, crmDe(p, api, "ombre")),
  },
  {
    name: "dzf_lead_destinataires", label: "Leads : qui reçoit ?", category: "Leads immobiliers", icon: "fas fa-user-check", output: "destinataires",
    description: "Donne les adresses exactes qui recevraient un lead de ce négociateur à cette date, avec l'explication (règle, congés, mi-temps, remplaçant, siège). C'est le bouton « tester ».",
    params: [{ name: "negociateur", label: "Négociateur (id)", required: true }, { name: "date", label: "Date", default: "", help: "Vide = maintenant" },
      { name: "prix", label: "Prix du bien (€)", default: "", help: "Pour les copies avec seuil de prix. Vide = prix inconnu" }, P_ROUTAGE, P_TABLES],
    run: async (p) => destinataires(p.negociateur, p.date || new Date(), await routageDe(p), { prix: p.prix }),
  },
  {
    name: "dzf_lead_absents", label: "Leads : absents de la semaine", category: "Leads immobiliers", icon: "fas fa-umbrella-beach", output: "absents",
    description: "Qui est absent cette semaine (congés ou jours non travaillés à mi-temps), et qui prend le relais.",
    params: [P_ROUTAGE, P_TABLES, { name: "semaine", label: "Un jour de la semaine voulue", default: "" }],
    run: async (p) => absentsSemaine(await routageDe(p), p.semaine || new Date()),
  },
  {
    name: "dzf_lead_qui_recoit", label: "Leads : tenir à jour « qui reçoit aujourd'hui »", category: "Leads immobiliers", icon: "fas fa-people-arrows", output: "qui_recoit", timeout: 60,
    description: "Pour chaque négociateur, écrit dans une table qui recevrait un lead aujourd'hui, et pourquoi (congés, mi-temps, départ, remplaçant, règle). À lancer quand l'équipe change et chaque nuit : la fin d'un congé se voit d'elle-même.",
    params: [P_ROUTAGE, P_TABLES, { name: "table", label: "Table écrite", type: "table", default: "vue_routage", help: "Colonnes : personne, nom, destinataires, detail, remplace (remplacé alors qu'actif), inactif, maj_le (les autres sont ignorées)" },
      { name: "roles", label: "Rôles concernés", default: "negociateur" }],
    run: async (p, ctx, api) => {
      const conf = await routageDe(p);
      const t = api.Table.findOne({ name: p.table || "vue_routage" });
      if (!t) throw perm(`table « ${p.table || "vue_routage"} » introuvable`);
      const champs = new Set(t.getFields().map((f) => f.name));
      const roles = String(p.roles || "negociateur").split(",").map((x) => x.trim()).filter(Boolean);
      const maintenant = new Date();
      const lignes = (conf.personnes || []).filter((x) => roles.includes(x.role)).map((x) => {
        const r = destinataires(x.id, maintenant, conf, { apercu: true });
        const liste = r.liste || [];
        const perso = liste.find((d) => d.email === String(x.email || "").toLowerCase());
        return { personne: x.id, nom: x.nom, destinataires: liste.map((d) => `${d.email} (${d.roles.join(", ")})`).join(" · "),
          detail: (r.trace || []).join(" · "), remplace: liste.some((d) => /^remplace/.test(d.raison || "")) || (x.actif !== false && !perso), inactif: x.actif === false, maj_le: maintenant };
      });
      const garder = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => champs.has(k)));
      /* petite table (une ligne par personne) : on remplace tout, d'un coup */
      await t.deleteRows({});
      for (const l of lignes) await t.insertRow(garder(l));
      return { lignes: lignes.length, remplaces: lignes.filter((l) => l.remplace).length };
    },
  },
  {
    name: "dzf_crm", label: "CRM immobilier : consulter", category: "Leads immobiliers", icon: "fas fa-address-book", output: "crm", timeout: 90,
    description: "Lecture seule dans le CRM (Immofacile ou Salesforce) : tester la connexion, lire un bien, chercher par référence, chercher un contact par e-mail ou téléphone.",
    params: [...P_CRM, { name: "action", label: "Action", type: "select", options: ["tester la connexion", "lire un bien", "biens par référence", "contacts par e-mail", "contacts par téléphone"], default: "tester la connexion" },
      { name: "valeur", label: "Valeur", showIf: { action: ["lire un bien", "biens par référence", "contacts par e-mail", "contacts par téléphone"] } }],
    run: async (p, ctx, api) => {
      const crm = crmDe(p, api, "ombre");
      switch (p.action) {
        case "tester la connexion": return crm.tester();
        case "lire un bien": return crm.bienParId(p.valeur);
        case "biens par référence": return crm.biensParReference(p.valeur);
        case "contacts par e-mail": return crm.contactsParEmail(p.valeur);
        default: return crm.contactsParTelephone(require("../lib/leads/valeurs").telephone(p.valeur));
      }
    },
  },
];
