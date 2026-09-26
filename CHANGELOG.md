# Journal des versions

## 2.4.2

- **Exécuter un parcours** (`dzf_parcours`, catégorie Contrôle) : déroule un schéma dessiné avec le widget « parcours » de dysizz-ui (début, étapes, conditions oui/non, validations, blocs, workflows, fin). Pour construire chez un client son propre outil de workflow : ses équipes dessinent, ce bloc exécute.
  - **Sécurité** : le schéma vient des données, pas de l'admin. Seuls les blocs et workflows listés par l'admin dans le bloc peuvent tourner ; les conditions passent toujours par le bac à sable des formules Saltcorn, même dans le tenant racine ; un parcours ne peut pas en lancer un autre ; limite d'étapes contre les boucles.
  - **Validation** : une étape « Validation » arrête le parcours (statut `en_attente`, étapes suivantes renvoyées) ; on reprend avec « Reprendre à l'étape ».
  - **Simulation** : suit le chemin et évalue les conditions sans rien lancer.
  - Numéroté 2.4.2 pour ne pas entrer en collision avec les 2.5.0 / 2.6.0 restées sur le PC de Sidy.

## 2.4.1

- **Cloisonnement entre tenants** (`src/garde.js`). Un admin de tenant n'est plus forcément l'admin du serveur :
  - les secrets du serveur (base, sessions, clé du coffre, Redis) ne sont **jamais** lisibles depuis un workflow, un point d'API, un écouteur ou un CRM, même demandés par leur nom ;
  - hors tenant racine, seules les variables listées dans `DZF_ENV_PARTAGEES` (réglée sur le serveur) sont lisibles ; sinon chaque tenant utilise son propre coffre ;
  - les conditions et expressions JavaScript (« Liste : filtrer », « Vérifier une condition ») tournent dans le bac à sable des formules Saltcorn hors tenant racine, compilées une seule fois par liste.
- « Liste : filtrer » : l'expression n'est plus interpolée (`{{ }}`). Une valeur reçue ne peut plus devenir du code ; les variables s'écrivent `ctx.nom`.
- Build : `index.js` identique quel que soit le dossier de lancement (la CI était rouge à chaque push).

## 2.4.0

- **Famille OVHcloud (14 blocs)** : tout gérer sans ouvrir l'espace client — clé d'accès, services qui expirent, domaines, enregistrements DNS sans doublon, sous-domaine complet en un bloc (DNS + hébergement + SSL, vérification publique), zone (export / import, DNSSEC), redirections, e-mails MX Plan, hébergement, VPS, dédiés, Public Cloud, factures. Client signé commun : horloge OVH mesurée une fois, reprise sur 429/5xx, erreurs lisibles.
- **Famille Leads immobiliers (6 blocs)** et moteur `lib/leads` : lecture déterministe des mails de 30 portails (chaque champ dit d'où il vient), rapprochement du bien selon la procédure « non-conformes » (référence, moins le dernier caractère, segments de droite à gauche, critères un par un, contradiction = rejet), contact (priorité à l'e-mail puis au plus récent), consentement anti-démarchage avec le mail d'origine en preuve, destinataires (règles, congés, mi-temps, chaîne de remplacement, siège). Adaptateurs CRM Immofacile V2 et Salesforce, mode ombre (écritures bloquées au niveau HTTP). Mesuré sur 4 000 vrais mails : moins d'1 ms par mail ; même bien que l'ancien système dans 1 794 cas sur 1 803 (les 9 écarts : identifiant CRM donné par le portail, ou référence tronquée par l'ancien) ; 216 biens retrouvés que l'ancien envoyait en quarantaine ; 24 laissés « à vérifier » que l'ancien trouvait. Mêmes destinataires dans 1 780 cas sur 1 827 (écarts dus aux changements de réglages depuis).
- **Écouteurs de boîtes mail** (IMAP IDLE) : remplacent le plugin imap-idle ; événement `DzfMailRecu` pour les workflows.
- API pour les autres plugins : `dysizz_flow_api.leads` (moteur), `crmDepuisCoffre` (CRM dont les secrets restent dans le coffre), `ecouteurs`.

## 2.3.1

- Flux plus solides : nouvel essai si le site coupe la connexion, flux YouTube en 404 lus par la playlist « mises en ligne » de la chaîne, et une page web donnée à la place d'un flux fait chercher le flux tout seul (lien annoncé par la page, puis /feed, /rss.xml…). Le flux trouvé est rendu dans `<sortie>_chaines`.

## 2.3.0

- **79 nouveaux blocs (182 en tout)**, du plus simple au plus poussé : stockage (S3 signé v4, ZIP, WebDAV, IPFS), documents (PDF sans service externe, Gotenberg, Excel, Word avec modèles, QR SEPA, OCR/Tika), IA avancée (images, voix, vision, agent avec outils, RAG), blockchain (Ethereum et compatibles avec signature des transactions, Bitcoin, cours), DevOps (GitHub, GitLab, Docker, Dokploy, Kubernetes, Cloudflare, OVHcloud), données externes (PostgreSQL, Meilisearch, Elasticsearch, Qdrant, ClickHouse, InfluxDB, Supabase, Airtable, Notion, Google Sheets, Baserow, NocoDB), objets connectés (MQTT, WebSocket, Home Assistant), pratique (météo, adresses, itinéraires, jours fériés, SIRENE, change, Wikipédia, IBAN/TVA, cron, Stripe), messageries libres (Matrix, Mattermost, Gotify, Pushover, Signal).
- Résultats fichiers au choix : fichier Saltcorn ou base64 passé au bloc suivant (ex. Excel → S3, QR → PDF).
- Catalogue : météo du matin, export Excel vers S3, PDF à chaque facture (avec QR de paiement), suivi d'un portefeuille crypto, assistant IA pour les pages (crée aussi son point d'API).
- Points d'API : nouvelle protection « session » (utilisateur connecté, anti-CSRF) pour les widgets des pages.
- Les réglages d'un bloc peuvent s'afficher selon un autre réglage (showIf).
- Cryptographie blockchain : @noble/curves et @noble/hashes (audités), inclus au build.

## 2.2.0

- **Emploi : chercher dans plusieurs sources** (`dzf_emplois`) : France Travail, Adzuna, Jooble (clés gratuites), Arbeitnow, Remotive, RemoteOK, Jobicy, Himalayas (sans clé), flux RSS. Filtre mots-clés / lieu / télétravail / alternance / date, dédoublonnage, bilan par source.
- **Surveillance avancée** : scénario d'API avec vérifications, expiration de domaine (RDAP), liste noire (DNSBL), page modifiée, DNS modifié, Prometheus, note de sécurité A-F.
- **Articles : trouver une image** (og:image) pour les flux sans image.
- Tests : chaque fichier dans son propre processus.

## 2.1.0

- **Éditeur visuel de workflows** (`/dysizz-flow/workflows`) : toile façon n8n, blocs reliés par des flèches, glisser-déposer, « si… sinon… » sans code, formulaire simple pour chaque bloc avec le bouton **{ }** pour insérer une variable, onglet Code pour les techniciens, JSON du workflow entier, annuler / rétablir, essai avec le contexte affiché et l'étape en erreur surlignée. Tout est enregistré en une fois : plus de lag en tapant. Il lit et écrit les vrais workflows Saltcorn.
- **Catalogue** : 18 modèles en cartes avec un petit schéma, filtres par thème ; les tables qui manquent peuvent être créées toutes seules ; le workflow s'ouvre directement dans l'éditeur. Nouveaux : rapport du jour par e-mail, webhook signé sans doublon, alerte sur seuil, relance après N jours.
- Bouton « Ouvrir dans l'éditeur visuel » sur les pages natives des workflows Saltcorn.
- Tuiles sur l'accueil Dysizz, coffre utilisable par les autres plugins (`dysizz_flow_api`).
- IMAP : en plus du texte, le HTML nettoyé (`html`) et `contenu` (HTML s'il existe, sinon texte).
- Correction : le bloc CVE renvoyait un champ `id` qui entrait en conflit avec l'id des tables ; il s'appelle maintenant `cve`.

## 2.0.0

- 103 blocs (39 avant) : sécurité (13), surveillance (7), logs et métriques (6), tâches et planification (9), et des compléments en données, transformer, API, messagerie, IA et contrôle.
- Moteur : essais avec pause croissante, erreurs définitives sans nouvel essai, secrets lus dans l'environnement puis dans le coffre, métriques par bloc écrites une fois par heure.
- Points d'API publics `/dzf/api/<nom>` : jeton ou HMAC, limite de débit, compte d'exécution au choix.
- Coffre de secrets chiffré, page Supervision, versions des blocs perso avec retour arrière.
- Blocs apportés par d'autres plugins (`dysizz_flow_blocks`, préfixe `dzx_`).
- 4 nouveaux modèles : surveillance de sites, santé de la plateforme, veille CVE, file de travaux.
- Tables : `dzf_metriques`, `dzf_mesures`, `dzf_secrets`, `dzf_planifs`, `dzf_points`, `dzf_file`, `dzf_versions` ; les champs ajoutés par une mise à jour sont créés tout seuls.
- Corrections : le verrou ne provoque plus d'erreur SQL (compatible avec « Tester » de Saltcorn), les lectures de tables ne renvoient jamais les mots de passe ni les jetons.

## 1.0.0

- 39 blocs workflow (données, transformer, réseau, messagerie, IA, services, contrôle), utilisables comme étapes de workflow, déclencheurs ou boutons.
- Réglages sans code avec `{{variables}}`, code visible pour chaque bloc, essai en direct.
- Atelier : blocs perso (réglages + code), enregistrés dans `dzf_blocs`, disponibles sans redémarrage sur tous les serveurs, export / import JSON.
- 10 modèles de workflows installables.
- Journal des erreurs, verrous, cache et limite de débit (Redis ou table), client Redis intégré.
