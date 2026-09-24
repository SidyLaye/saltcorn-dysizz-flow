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
  {
    key: "surveillance_sites", label: "Surveillance de sites (uptime)", category: "Surveillance", when: "Often",
    description: "Toutes les 5 minutes : appelle chaque site actif de ta table, note l'état et le temps de réponse, garde l'historique des temps (dzf_mesures) et te prévient une seule fois quand un site tombe, puis quand il revient.",
    vars: [{ name: "table_sites", label: "Table des sites (champs url unique, actif, etat, ms, raison, verifie_le)", default: "sites" }, { name: "lent_ms", label: "Lent au-delà de (ms)", default: "2000" }],
    steps: chain(
      st("sites", "dzf_table_chercher", { table: "%%table_sites%%", filtre: '{"actif":true}', limite: 500, sortie: "sites" }),
      st("maintenant", "dzf_dates", { operation: "maintenant", format: "iso", sortie: "maintenant" }),
      st("appeler", "dzf_ping_http", { cibles: "{{sites}}", lent_ms: "%%lent_ms%%", en_parallele: 8, sortie: "resultats", delai_max: 110 }),
      st("preparer", "dzf_liste_transformer", { liste: "{{resultats}}", modele: '{"url":"{{item.url}}","etat":"{{item.etat}}","ms":"{{item.ms}}","raison":"{{item.raison}}","verifie_le":"{{maintenant}}"}', sortie: "lignes" }),
      st("ranger", "dzf_table_upsert", { table: "%%table_sites%%", liste: "{{lignes}}", cle: "url", mettre_a_jour: "etat,ms,raison,verifie_le", sans_declencheurs: true, sortie: "bilan" }),
      st("pannes", "dzf_liste_filtrer", { liste: "{{resultats}}", champ: "etat", operateur: "=", valeur: "panne", sortie: "pannes" }),
      st("alerte", "dzf_alerte", { cle: "sites-%%table_sites%%", probleme: "{{pannes}}", silence_min: 60, sortie: "alerte" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "Sites : {{alerte.etat}}", texte: "{{pannes.length}} site(s) en panne", lien: "/page/%%table_sites%%" }, { only_if: "alerte.envoyer" }),
    ),
  },
  {
    key: "sante_plateforme", label: "Santé de la plateforme", category: "Surveillance", when: "Hourly",
    description: "Chaque heure : serveur (disque, mémoire, charge), Postgres (connexions, requêtes longues, verrous) et workflows en erreur. Mesures gardées pour les graphiques, alerte sans spam.",
    vars: [{ name: "seuil_disque", label: "Alerte disque au-delà de (%)", default: "85" }],
    steps: chain(
      st("serveur", "dzf_sante_serveur", { seuil_disque: "%%seuil_disque%%", seuil_memoire: 90, sortie: "serveur" }),
      st("postgres", "dzf_sante_postgres", { requete_longue_s: 30, sortie: "postgres", si_erreur: "continuer" }),
      st("workflows", "dzf_workflows_etat", { heures: 1, sortie: "workflows" }),
      st("mesure_disque", "dzf_metrique", { nom: "serveur.disque_pct", valeur: "{{serveur.disque_pct}}" }, { only_if: "serveur.disque_pct !== null" }),
      st("mesure_memoire", "dzf_metrique", { nom: "serveur.memoire_pct", valeur: "{{serveur.memoire_pct}}" }),
      st("bilan", "dzf_definir", { valeurs: '{"problemes":"{{serveur.alertes}}","wf_erreurs":"{{workflows.erreurs}}"}', sortie: "bilan" }),
      st("alerte", "dzf_alerte", { cle: "plateforme", probleme: "{{serveur.alertes}}", silence_min: 360, sortie: "alerte" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "Plateforme : {{alerte.etat}}", texte: "{{serveur.alertes}}", lien: "/dysizz-flow/supervision" }, { only_if: "alerte.envoyer" }),
    ),
  },
  {
    key: "veille_cve", label: "Veille failles (CVE) → table", category: "Sécurité", when: "Daily",
    description: "Chaque jour : cherche les nouvelles failles publiées (base NVD) pour tes technologies et les range dans une table, sans doublon. Prévient pour les critiques.",
    vars: [{ name: "table_cve", label: "Table des failles (champs cve unique, gravite, score, resume, url, publiee)", default: "failles" }, { name: "mot_cle", label: "Technologie surveillée", default: "postgresql" }, { name: "gravite", label: "Gravité minimale (MEDIUM, HIGH, CRITICAL)", default: "HIGH" }],
    steps: chain(
      st("chercher", "dzf_cve", { mot_cle: "%%mot_cle%%", jours: 7, gravite_min: "%%gravite%%", sortie: "failles", delai_max: 90, essais: 2 }),
      st("nouvelles", "dzf_liste_dedoublonner", { liste: "{{failles}}", cle: "cve", table: "%%table_cve%%", sortie: "nouvelles" }),
      st("ranger", "dzf_table_upsert", { table: "%%table_cve%%", liste: "{{nouvelles}}", cle: "cve", sortie: "bilan" }),
      st("critiques", "dzf_liste_filtrer", { liste: "{{nouvelles}}", champ: "gravite", operateur: "=", valeur: "CRITICAL", sortie: "critiques" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "{{critiques.length}} faille(s) critique(s) : %%mot_cle%%", lien: "/page/%%table_cve%%" }, { only_if: "critiques.length > 0" }),
    ),
  },
  {
    key: "file_de_travaux", label: "File de travaux (worker)", category: "Tâches", when: "Often",
    description: "Toutes les 5 minutes : prend jusqu'à N travaux dans une file (dzf_file), lance un workflow pour chacun, et marque réussi ou échoué. Pour traiter de gros volumes sans bloquer, sur un ou plusieurs serveurs.",
    vars: [{ name: "file", label: "Nom de la file", default: "travaux" }, { name: "workflow", label: "Workflow qui traite UN travail (reçoit « travail »)" }, { name: "nombre", label: "Travaux par passage", default: "20" }],
    steps: chain(
      st("verrou", "dzf_verrou", { action: "prendre", nom: "file-%%file%%", duree: 300, sortie: "verrou" }, { next_step: 'verrou ? "prendre" : ""' }),
      st("prendre", "dzf_file_prendre", { file: "%%file%%", nombre: "%%nombre%%", sortie: "travaux" }),
      st("traiter", "dzf_pour_chaque", { liste: "{{travaux}}", workflow: "%%workflow%%", variable: "travail", en_parallele: 4, sortie: "boucle" }, { only_if: "travaux.length > 0" }),
      st("reussis", "dzf_file_terminer", { travaux: "{{boucle.reussis}}", resultat: "réussi" }, { only_if: "travaux.length > 0 && boucle.reussis.length > 0" }),
      st("echecs", "dzf_file_terminer", { travaux: "{{boucle.echecs}}", resultat: "erreur" }, { only_if: "travaux.length > 0 && boucle.echecs.length > 0" }),
      st("liberer", "dzf_verrou", { action: "libérer", nom: "file-%%file%%", sortie: "verrou" }),
    ),
  },
  {
    key: "rapport_mail", label: "Rapport du jour par e-mail", category: "Organisation", when: "Daily",
    description: "Chaque matin : compte ce qui compte dans une table (ex. tâches du jour, nouveaux mails) et t'envoie un e-mail récapitulatif avec la liste.",
    vars: [{ name: "table", label: "Table", default: "taches" }, { name: "filtre", label: "Lignes à lister (filtre JSON)", default: '{"not":{"statut":"fait"}}' }, { name: "champ", label: "Champ affiché pour chaque ligne", default: "titre" },
      { name: "destinataire", label: "Envoyer à (e-mail)", default: "" }],
    steps: chain(
      st("lignes", "dzf_table_chercher", { table: "%%table%%", filtre: "%%filtre%%", limite: 50, sortie: "lignes" }),
      st("texte", "dzf_texte", { modele: "Bonjour,\n\n{{nombre}} élément(s) aujourd'hui :\n{{lignes}}", liste: "{{lignes}}", modele_ligne: "- {{item.%%champ%%}}", sortie: "texte" }),
      st("envoyer", "dzf_mail_envoyer", { a: "%%destinataire%%", sujet: "Ton rapport du jour", texte: "{{texte}}", sortie: "envoi" }, { only_if: "lignes.length > 0" }),
    ),
  },
  {
    key: "webhook_signe", label: "Webhook signé → table (sans doublon)", category: "Intégrations", when: "Never",
    description: "À relier à un Point d'API (protection HMAC) : vérifie qu'un même événement n'est pas traité deux fois, range les données reçues dans une table et répond « reçu ».",
    vars: [{ name: "table", label: "Table de destination" }, { name: "cle", label: "Champ qui identifie l'événement dans les données reçues", default: "id" }, { name: "modele", label: "Correspondance (JSON)", default: '{"ref":"{{corps.id}}","type":"{{corps.type}}","donnees":"{{corps_brut}}"}' }],
    steps: chain(
      st("deja", "dzf_idempotence", { cle: "webhook-{{corps.%%cle%%}}", duree_h: 72, sortie: "deja" }),
      st("ligne", "dzf_definir", { valeurs: "%%modele%%", sortie: "ligne" }, { only_if: "!deja.deja_traite" }),
      st("ranger", "dzf_table_ajouter", { table: "%%table%%", valeurs: "{{ligne}}", sortie: "id" }, { only_if: "!deja.deja_traite" }),
      st("repondre", "dzf_definir", { valeurs: '{"reponse":{"recu":true}}', fusionner: true }),
    ),
  },
  {
    key: "seuil_alerte", label: "Alerte si une valeur dépasse un seuil", category: "Surveillance", when: "Hourly",
    description: "Chaque heure : calcule une valeur dans une table (somme, nombre, max…), la garde en métrique pour le graphique et te prévient une seule fois quand elle dépasse le seuil, puis quand elle redescend.",
    vars: [{ name: "table", label: "Table" }, { name: "stat", label: "Calcul (compter, somme, max, min, moyenne)", default: "compter" }, { name: "champ", label: "Champ (sauf pour compter)", default: "" },
      { name: "filtre", label: "Filtre (JSON, facultatif)", default: "{}" }, { name: "seuil", label: "Seuil", default: "100" }, { name: "nom", label: "Nom de la métrique", default: "ma.valeur" }],
    steps: chain(
      st("valeur", "dzf_table_compter", { table: "%%table%%", stat: "%%stat%%", champ: "%%champ%%", filtre: "%%filtre%%", sortie: "valeur" }),
      st("mesure", "dzf_metrique", { nom: "%%nom%%", valeur: "{{valeur}}" }),
      st("depasse", "dzf_calcul", { formule: "Math.max(0, {{valeur}} - %%seuil%%)", sortie: "depasse" }),
      st("alerte", "dzf_alerte", { cle: "seuil-%%nom%%", probleme: "{{depasse}}", silence_min: 360, sortie: "alerte" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "%%nom%% : {{alerte.etat}}", texte: "Valeur actuelle : {{valeur}} (seuil %%seuil%%)" }, { only_if: "alerte.envoyer" }),
    ),
  },
  {
    key: "relance_planifiee", label: "Relance automatique après N jours", category: "Organisation", when: "Insert", tableVar: "table",
    description: "Quand une ligne est ajoutée (ex. une candidature, un devis), programme une relance dans N jours. Si la ligne a changé de statut entre-temps, la relance ne part pas.",
    vars: [{ name: "table", label: "Table surveillée", default: "candidatures" }, { name: "jours", label: "Relancer après (jours)", default: "7" }, { name: "workflow", label: "Workflow qui fait la relance (reçoit « ligne »)" }],
    steps: chain(
      st("planifier", "dzf_planifier", { workflow: "%%workflow%%", dans: "%%jours%%", unite: "jours", contexte: '{"ligne":{"id":"{{id}}"}}', cle: "relance-%%table%%-{{id}}", sortie: "planifie" }),
    ),
  },
  {
    key: "meteo_matin", label: "Météo du matin sur ton téléphone", category: "Pratique", when: "Daily",
    description: "Chaque matin : la météo du jour et des prochains jours pour ta ville, envoyée en notification (et un rappel parapluie s'il risque de pleuvoir).",
    vars: [{ name: "ville", label: "Ville", default: "Paris" }],
    steps: chain(
      st("meteo", "dzf_meteo", { lieu: "%%ville%%", jours: 3, sortie: "meteo" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "Météo : {{meteo.resume}}", texte: "Aujourd'hui {{meteo.jours.0.min}}° à {{meteo.jours.0.max}}°, pluie {{meteo.jours.0.risque_pluie}} %. Demain : {{meteo.jours.1.ciel}}, {{meteo.jours.1.max}}°." }),
      st("parapluie", "dzf_notifier", { qui: "administrateurs", titre: "☔ Prends un parapluie", texte: "Risque de pluie {{meteo.jours.0.risque_pluie}} % aujourd'hui à %%ville%%." }, { only_if: "meteo.jours[0].risque_pluie >= 60" }),
    ),
  },
  {
    key: "export_excel_s3", label: "Export Excel chaque semaine vers S3", category: "Stockage", when: "Weekly",
    description: "Chaque semaine : exporte une table en vrai fichier Excel et le dépose dans ton stockage S3 (OVH, Scaleway, MinIO, AWS…). Une sauvegarde lisible par tout le monde.",
    vars: [{ name: "table", label: "Table à exporter", default: "contacts" }, { name: "seau", label: "Bucket S3" }, { name: "point", label: "Adresse du service S3", default: "https://s3.gra.io.cloud.ovh.net" }, { name: "region", label: "Région", default: "gra" }],
    steps: chain(
      st("lignes", "dzf_table_chercher", { table: "%%table%%", filtre: "{}", limite: 50000, sortie: "lignes" }),
      st("excel", "dzf_excel_ecrire", { donnees: "{{lignes}}", nom: "%%table%%.xlsx", sortie_fichier: "base64 (dans le workflow)", sortie: "excel" }),
      st("envoyer", "dzf_s3_envoyer", { point: "%%point%%", region: "%%region%%", seau: "%%seau%%", cles: "S3_CLES", style: "chemin", source: "{{excel}}", cle: "exports/%%table%%-{{excel.octets}}.xlsx", sortie: "envoi" }),
    ),
  },
  {
    key: "facture_pdf", label: "PDF automatique à chaque nouvelle facture", category: "Documents", when: "Insert", tableVar: "table",
    description: "Quand une facture (ou un devis) est ajoutée, fabrique son PDF propre avec un QR code de paiement SEPA, et range le lien du PDF dans la ligne.",
    vars: [{ name: "table", label: "Table des factures", default: "factures" }, { name: "champ_pdf", label: "Champ où ranger le PDF", default: "pdf" }, { name: "societe", label: "Ta société", default: "Ma société" }, { name: "iban", label: "Ton IBAN", default: "" }],
    steps: chain(
      st("qr", "dzf_qr", { type: "virement SEPA", beneficiaire: "%%societe%%", iban: "%%iban%%", montant: "{{montant}}", reference: "Facture {{numero}}", taille: 240, sortie: "qr" }),
      st("pdf", "dzf_pdf_creer", { format: "Markdown", titre: "Facture {{numero}}", auteur: "%%societe%%", contenu: "# Facture {{numero}}\n\n**%%societe%%**\n\nClient : {{client}}\n\n| Désignation | Montant |\n|---|---|\n| {{libelle}} | {{montant}} € |\n\n---\n\nPayer par virement en scannant ce code avec ton appli bancaire :\n\n![QR de paiement]({{qr.png_data_uri}})", nom: "facture-{{numero}}.pdf", sortie: "pdf" }),
      st("ranger", "dzf_table_modifier", { table: "%%table%%", id: "{{id}}", valeurs: '{"%%champ_pdf%%":"{{pdf.chemin}}"}', sans_declencheurs: true, sortie: "modifies" }),
    ),
  },
  {
    key: "crypto_suivi", label: "Prévenir quand un portefeuille crypto reçoit des fonds", category: "Blockchain", when: "Hourly",
    description: "Chaque heure : regarde les transferts d'un jeton (USDC, EURC…) arrivés sur ton adresse et te prévient avec le montant et le lien.",
    vars: [{ name: "reseau", label: "Réseau", default: "Base" }, { name: "jeton", label: "Contrat du jeton", default: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, { name: "adresse", label: "Ton adresse (0x…)" }],
    steps: chain(
      st("recus", "dzf_evm_evenements", { reseau: "%%reseau%%", contrat: "%%jeton%%", evenement: "Transfer(address indexed from, address indexed to, uint256 value)", derniers_blocs: 1800, filtre_2: "%%adresse%%", sortie: "recus" }),
      st("prevenir", "dzf_notifier", { qui: "administrateurs", titre: "💰 {{recus.nombre}} transfert(s) reçu(s)", texte: "Dernier : {{recus.liste.0.value}} (unités brutes) de {{recus.liste.0.from}} — {{recus.liste.0.lien}}" }, { only_if: "recus.nombre > 0" }),
    ),
  },
  {
    key: "assistant_chat", label: "Assistant IA pour tes pages (chat)", category: "IA", when: "Never",
    description: "Le cerveau du bloc « Chat IA » de dysizz-ui : reçoit la question de l'utilisateur connecté, laisse l'agent chercher dans tes tables ou lancer tes workflows, et renvoie la réponse. Crée aussi l'adresse /dzf/api/<nom> à mettre dans le bloc.",
    vars: [{ name: "point", label: "Nom de l'adresse", default: "assistant" }, { name: "url_base", label: "API IA (compatible OpenAI)", default: "http://ollama:11434/v1" }, { name: "modele", label: "Modèle", default: "qwen2.5" },
      { name: "variable_cle", label: "Secret de la clé (si besoin)", default: "" }, { name: "tables", label: "Tables consultables", default: "taches" }, { name: "workflows", label: "Workflows qu'il peut lancer", default: "" }],
    point: { nom: "%%point%%", auth: "session", reponse: "agent", limite_minute: 20 },
    steps: chain(
      st("agent", "dzf_ia_agent", { url_base: "%%url_base%%", modele: "%%modele%%", variable_cle: "%%variable_cle%%", consigne: "{{corps.message}}", tables: "%%tables%%", workflows: "%%workflows%%", web: false, etapes_max: 6, sortie: "agent", si_erreur: "continuer", delai_max: 300 }),
      st("secours", "dzf_definir", { valeurs: '{"agent":{"reponse":"Désolé, je n\'arrive pas à répondre pour l\'instant ({{agent_erreur}})."}}', fusionner: true }, { only_if: "!agent" }),
    ),
  },
];
