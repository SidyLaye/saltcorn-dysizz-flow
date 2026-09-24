/* Modèles de workflows : des enchaînements de blocs prêts à installer.
   À l'installation, chaque %%variable%% est remplacée par ce que tu as saisi,
   puis on crée un vrai workflow Saltcorn (déclencheur « Workflow » + étapes),
   que tu modifies ensuite dans l'éditeur de workflows natif. */
"use strict";

/* étapes en ligne droite : chacune enchaîne sur la suivante */
const chain = (...steps) => steps.map((s, i) => ({ ...s, next_step: s.next_step !== undefined ? s.next_step : steps[i + 1] ? steps[i + 1].name : "" }));
const st = (name, action_name, configuration, o = {}) => ({ name, action_name, configuration, ...o });

module.exports = [
  {
    key: "rss_vers_table", label: "Flux RSS / YouTube → table", category: "Veille", when: "Hourly",
    description: "Lit toutes les sources actives d'une table, garde les nouveautés et les range dans une autre table, sans doublon.",
    vars: [{ name: "table_sources", label: "Table des sources (champs url et/ou chaine, actif)", default: "veille_sources" }, { name: "table_articles", label: "Table des articles (champ url unique)", default: "veille_articles" }],
    steps: chain(
      st("sources", "dzf_table_chercher", { table: "%%table_sources%%", filtre: '{"actif":true}', limite: 500, sortie: "sources" }),
      st("lire", "dzf_rss", { sources: "{{sources}}", max_par_source: 30, en_parallele: 4, sortie: "articles", delai_max: 120 }),
      st("nouveaux", "dzf_liste_dedoublonner", { liste: "{{articles}}", cle: "url", table: "%%table_articles%%", sortie: "nouveaux" }),
      st("preparer", "dzf_liste_transformer", { liste: "{{nouveaux}}", modele: '{"titre":"{{item.titre}}","url":"{{item.url}}","date":"{{item.date}}","resume":"{{item.resume}}","image":"{{item.image}}","auteur":"{{item.auteur}}","video_id":"{{item.video_id}}","source":"{{item.source}}"}', sortie: "lignes" }),
      st("ranger", "dzf_table_upsert", { table: "%%table_articles%%", liste: "{{lignes}}", cle: "url", sortie: "bilan" }),
      st("erreurs", "dzf_journal", { message: "Sources en erreur : {{articles_erreurs}}", erreur: true }, { only_if: "articles_erreurs && articles_erreurs.length > 0" }),
    ),
  },
  {
    key: "imap_vers_table", label: "Boîte mail (IMAP) → table", category: "Messagerie", when: "Often",
    description: "Toutes les 5 minutes : relève les nouveaux mails (lecture seule), sans jamais relire deux fois, avec un verrou pour ne pas tourner en double.",
    vars: [{ name: "table_mails", label: "Table des mails (champs uid, message_id, de, sujet, date…)", default: "mails" }, { name: "utilisateur", label: "Adresse de la boîte" },
      { name: "serveur", label: "Serveur IMAP", default: "ssl0.ovh.net" }, { name: "variable", label: "Variable d'environnement du mot de passe", default: "DZ_MAIL_PASSWORD" }],
    steps: chain(
      st("verrou", "dzf_verrou", { action: "prendre", nom: "imap-%%table_mails%%", duree: 600, sortie: "verrou" }, { next_step: 'verrou ? "dernier" : ""' }),
      st("dernier", "dzf_table_compter", { table: "%%table_mails%%", stat: "max", champ: "uid", sortie: "dernier_uid" }),
      st("relever", "dzf_imap_lire", { serveur: "%%serveur%%", port: 993, utilisateur: "%%utilisateur%%", variable_mot_de_passe: "%%variable%%", dossier: "INBOX", depuis_uid: "{{dernier_uid}}", jours: 14, max: 100, sortie: "nouveaux", si_erreur: "continuer", delai_max: 180 }),
      st("ranger", "dzf_table_upsert", { table: "%%table_mails%%", liste: "{{nouveaux}}", cle: "message_id", sortie: "bilan" }),
      st("liberer", "dzf_verrou", { action: "libérer", nom: "imap-%%table_mails%%", sortie: "verrou" }),
    ),
  },
  {
    key: "rappel_quotidien", label: "Rappel du matin", category: "Organisation", when: "Daily",
    description: "Chaque jour : compte les lignes qui demandent ton attention (ex. tâches en retard) et envoie une notification s'il y en a.",
    vars: [{ name: "table", label: "Table", default: "taches" }, { name: "filtre", label: "Filtre (JSON)", default: '{"not":{"statut":"fait"},"echeance":{"lt":"{{demain}}"}}' },
      { name: "titre", label: "Titre de la notification", default: "{{total}} tâche(s) pour aujourd'hui" }, { name: "lien", label: "Lien", default: "/page/taches" }],
    steps: chain(
      st("demain", "dzf_dates", { operation: "ajouter des jours", jours: 1, format: "jour (AAAA-MM-JJ)", sortie: "demain" }),
      st("compter", "dzf_table_compter", { table: "%%table%%", filtre: "%%filtre%%", stat: "compter", sortie: "total" }),
      st("notifier", "dzf_notifier", { qui: "administrateurs", titre: "%%titre%%", lien: "%%lien%%", sortie: "notifies" }, { only_if: "total > 0" }),
    ),
  },
  {
    key: "webhook_vers_table", label: "Webhook → table", category: "Intégrations", when: "API call",
    description: "Reçoit des données d'un autre outil (n8n, formulaire, Stripe…) sur l'adresse /api/action/<nom> et les range dans une table.",
    vars: [{ name: "table", label: "Table de destination" }, { name: "modele", label: "Correspondance (JSON)", default: '{"nom":"{{name}}","email":"{{email}}","source":"webhook"}' }],
    steps: chain(
      st("preparer", "dzf_definir", { valeurs: "%%modele%%", sortie: "ligne" }),
      st("ranger", "dzf_table_ajouter", { table: "%%table%%", valeurs: "{{ligne}}", sortie: "id" }),
    ),
  },
  {
    key: "export_csv", label: "Export CSV d'une table", category: "Données", when: "Weekly",
    description: "Chaque semaine : exporte une table en CSV dans les fichiers Saltcorn et te prévient avec le lien.",
    vars: [{ name: "table", label: "Table" }, { name: "filtre", label: "Filtre (JSON, facultatif)", default: "" }],
    steps: chain(
      st("date", "dzf_dates", { operation: "maintenant", format: "jour (AAAA-MM-JJ)", sortie: "jour" }),
      st("lire", "dzf_table_chercher", { table: "%%table%%", filtre: "%%filtre%%", limite: 10000, sortie: "lignes" }),
      st("csv", "dzf_csv", { operation: "liste → CSV", valeur: "{{lignes}}", separateur: ";", sortie: "csv" }),
      st("fichier", "dzf_fichier_ecrire", { nom: "%%table%%-{{jour}}.csv", contenu: "{{csv}}", type: "text/csv", dossier: "/exports", sortie: "fichier" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "Export %%table%% prêt", texte: "{{fichier}}", lien: "/files", sortie: "notifies" }),
    ),
  },
  {
    key: "resume_ia", label: "Résumé IA du jour", category: "IA", when: "Daily",
    description: "Chaque matin : prend les éléments ajoutés depuis hier (articles, mails…), les fait résumer par ton IA (Ollama par défaut) et t'envoie le résumé.",
    vars: [{ name: "table", label: "Table", default: "veille_articles" }, { name: "champ_date", label: "Champ date", default: "date" }, { name: "champ_titre", label: "Champ à résumer", default: "titre" },
      { name: "url_ia", label: "Adresse de l'IA", default: "http://ollama:11434/v1" }, { name: "modele_ia", label: "Modèle", default: "llama3.1" }],
    steps: chain(
      st("hier", "dzf_dates", { operation: "ajouter des jours", jours: -1, sortie: "hier" }),
      st("lire", "dzf_table_chercher", { table: "%%table%%", filtre: '{"%%champ_date%%":{"gt":"{{hier}}"}}', tri: "%%champ_date%%", decroissant: true, limite: 80, sortie: "lignes" }),
      st("resumer", "dzf_ia_resumer", { url_base: "%%url_ia%%", modele: "%%modele_ia%%", contenu: "{{lignes}}", champ: "%%champ_titre%%", sortie: "resume", delai_max: 180 }, { only_if: "lignes.length > 0" }),
      st("envoyer", "dzf_notifier", { qui: "administrateurs", titre: "Le résumé du jour", texte: "{{resume}}", sortie: "notifies" }, { only_if: "lignes.length > 0" }),
    ),
  },
  {
    key: "alerte_telegram", label: "Alerte mot-clé → Telegram", category: "Intégrations", when: "Insert",
    tableVar: "table",
    description: "À chaque nouvelle ligne d'une table : si un champ contient un mot-clé, un message Telegram part tout de suite.",
    vars: [{ name: "table", label: "Table surveillée", default: "veille_articles" }, { name: "champ", label: "Champ lu", default: "titre" }, { name: "mot", label: "Mot-clé", default: "critique" },
      { name: "chat", label: "Chat id Telegram" }],
    steps: chain(
      st("filtrer", "dzf_verifier", { condition: 'String(ctx["%%champ%%"] || "").toLowerCase().includes("%%mot%%".toLowerCase())', si_faux: "renvoyer faux", sortie: "trouve" }, { next_step: 'trouve ? "envoyer" : ""' }),
      st("envoyer", "dzf_telegram", { variable_jeton: "TELEGRAM_BOT_TOKEN", chat_id: "%%chat%%", texte: "{{%%champ%%}}", sortie: "telegram" }),
    ),
  },
  {
    key: "api_vers_table", label: "API → table (synchronisation)", category: "Intégrations", when: "Hourly",
    description: "Appelle une API qui renvoie une liste, transforme chaque élément et met la table à jour sans doublon.",
    vars: [{ name: "url", label: "Adresse de l'API" }, { name: "chemin", label: "Où est la liste dans la réponse", default: "http.data" }, { name: "table", label: "Table" },
      { name: "cle", label: "Champ clé", default: "ref" }, { name: "modele", label: "Correspondance (JSON)", default: '{"ref":"{{item.id}}","nom":"{{item.name}}"}' }],
    steps: chain(
      st("appeler", "dzf_http", { methode: "GET", url: "%%url%%", reponse: "json", essais: 3, sortie: "http", delai_max: 60 }),
      st("preparer", "dzf_liste_transformer", { liste: "{{%%chemin%%}}", modele: "%%modele%%", sortie: "lignes" }),
      st("ranger", "dzf_table_upsert", { table: "%%table%%", liste: "{{lignes}}", cle: "%%cle%%", mettre_a_jour: "", sortie: "bilan" }),
    ),
  },
  {
    key: "classement_ia", label: "Classer chaque nouvelle ligne avec l'IA", category: "IA", when: "Insert", tableVar: "table",
    description: "À chaque ajout (mail, ticket, article…) : l'IA choisit une catégorie et la note dans la ligne.",
    vars: [{ name: "table", label: "Table", default: "mails" }, { name: "champ", label: "Texte à lire", default: "sujet" }, { name: "champ_categorie", label: "Champ où écrire la catégorie", default: "categorie" },
      { name: "categories", label: "Catégories", default: "urgent, à traiter, info, pub" }, { name: "url_ia", label: "Adresse de l'IA", default: "http://ollama:11434/v1" }, { name: "modele_ia", label: "Modèle", default: "llama3.1" }],
    steps: chain(
      st("classer", "dzf_ia_classer", { url_base: "%%url_ia%%", modele: "%%modele_ia%%", texte: "{{%%champ%%}}", categories: "%%categories%%", sortie: "categorie", si_erreur: "continuer" }),
      st("noter", "dzf_table_modifier", { table: "%%table%%", id: "{{id}}", valeurs: '{"%%champ_categorie%%":"{{categorie}}"}', sans_declencheurs: true, sortie: "modifies" }, { only_if: "categorie" }),
    ),
  },
  {
    key: "offres_emploi", label: "Offres France Travail → table", category: "Services", when: "Hourly",
    description: "Cherche les nouvelles offres pour tes mots-clés et les range dans une table, sans doublon.",
    vars: [{ name: "table", label: "Table des offres (champ ref unique)", default: "offres_emploi" }, { name: "mots", label: "Mots-clés", default: "data engineer" }, { name: "departement", label: "Département(s)", default: "" }],
    steps: chain(
      st("chercher", "dzf_france_travail", { mots_cles: "%%mots%%", departement: "%%departement%%", depuis_jours: 3, sortie: "offres" }),
      st("ranger", "dzf_table_upsert", { table: "%%table%%", liste: "{{offres}}", cle: "ref", sortie: "bilan" }),
    ),
  },
];
