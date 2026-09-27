# Journal des versions

## 2.6.2

- Calcule les congés et jours travaillés dans le fuseau configuré du routage ; les dates de calendrier restent littérales (UTC reste le défaut).
- Suit les remplacements par identifiant, sans confondre deux personnes de même nom avec une boucle.
- Un mi-temps sans jour coché passe au remplaçant prévu. Une règle individuelle prime sur une règle de groupe, puis sur la règle générale.
- Supprime la copie automatique à l'assistante d'un négociateur inactif ; un remplacement explicitement réglé reste appliqué.
- Conserve les indicateurs d'erreur permanente et d'écriture ambiguë entre actions imbriquées pour éviter une nouvelle tentative externe.

## 2.6.1

- Réunit les fonctions locales 2.5/2.6 avec le cloisonnement des tenants, le bloc parcours et les corrections de build publiés sur main.
- Conserve les deux historiques 2.4.1/2.4.2 ci-dessous, issus de branches distinctes.
- Applique les contrôles du coffre aux accès IA et à la comparaison des secrets ; sépare les caches IA par fournisseur, modèle, endpoint et nom de clé.
- Borne les appels Immofacile (authentification et corps compris), reprend les lectures et signale les écritures ambiguës sans les rejouer.
- Ajoute le bloc générique `dzf_http_borne` pour réutiliser cette protection depuis les workflows Saltcorn.

## 2.6.0

L'IA revient, comme dans l'ancien AMBS, mais en dernier recours et avec apprentissage automatique.

- Lecture en trois étages (`lecture.lire`) : règles des portails connus → gabarits appris → IA seulement si le mail reste inconnu ou incomplet. `traiter` l'utilise ; sans IA ni gabarits, rien ne change.
- `ia` : même schéma que l'ancien nœud qualifier_ia (champs, critères du prospect, motifs regex, phrase de signature). Fournisseurs : plugin « large-language-model » de Saltcorn, OpenAI (ou API compatible), Anthropic. Le mail est placé entre balises et déclaré « donnée » ; chaque valeur rendue doit se retrouver dans le mail, sinon elle est refusée ; cache par empreinte ; nouvelles tentatives sur 429/5xx.
- `apprentissage` : chaque motif proposé par l'IA est rejoué sur le mail et doit retrouver la valeur lue ; motif refusé s'il contient une donnée du mail ou s'il est trop coûteux. Formes regroupées (source + nature + signature) ; une variante validée 2 fois dans une forme vue 3 fois devient active (règle d'AMBS). Plusieurs mises en page actives en même temps ; un gabarit qui échoue 3 fois de suite est suspendu et l'IA réapprend. Import de `gabarit_version` d'AMBS (`depuisAmbs`).
- Plateforme qui transmet les coordonnées de quelqu'un d'autre (adresse non personnelle) : n'est plus prise pour un mail direct du prospect (son nom affiché n'est plus pris pour celui du prospect) ; lue par gabarit ou IA.
- API : `iaDepuisCoffre` (clé lue dans l'environnement puis le coffre, jamais renvoyée ; cache séparé par client).
- Test : un portail jamais vu est appris en 3 mails puis lu sans IA ; changement de mise en page réappris ; IA en panne ou au plafond sans casse. Corpus AMBS : aucune régression.

## 2.5.0

Moteur « leads » revu autour du dossier (prospect × bien) et de la conversation.

- `conversation` : qui écrit (prospect, portail, équipe), clés du fil (relais du portail, e-mail, téléphone, référence citée), messages du mail et historique recopié (« Messages précédents » de Leboncoin, citations « Le … a écrit : », « De : … Envoyé : »), dates ramenées en UTC, signatures retirées, empreinte anti-doublon, commentaire CRM reconstruit et borné.
- `traiter` : réponse de l'équipe = événement du dossier (jamais un lead), réponse du prospect sans référence = relance avec le bien du dossier, projet de recherche créé une fois à partir des critères du bien, commentaire mis à jour ensuite, consentement une fois par contact, relances notifiées au négociateur seulement (réglable), étapes coupables par client, négociateur retrouvé par son nom ou un alias dans un titre (projets Giraffe), vendeur potentiel signalé, mail du propriétaire du bien signalé.
- `dossiers` : dépôt en mémoire et règle de mise à jour partagée avec dysizz-leads.
- Portails déclarés sans code (domaines, objets, libellés, référence) et détection d'un portail inconnu ; libellés coupés sur deux lignes recollés ; en-têtes de transfert en tableau HTML.
- Immofacile : projet de recherche avec les clés XML du site (`/criterias/search-requests`), `majRecherche` (commentaire), `ajouterAction`, `contact` avec `?include=origin,groups,…` (la relecture de l'ancien service ne les demandait pas), catalogue par curseur.
- Écouteurs : en-têtes de fil (In-Reply-To, References), empreinte, source `.eml` gardée (preuve), un seul serveur par boîte (verrou Postgres).
- `verrou` (Postgres, verrous consultatifs) et `secretEgal` (comparaison à temps constant) exposés aux autres plugins ; blocs externes réenregistrés si un plugin se charge après dysizz-flow.
- Tests : mutations de mails (99 variantes), fil de conversation complet, Immofacile en réel contre un faux serveur ; `tools/corpus.cjs` pour la non-régression sur un corpus réel. CI sur Node 18, 20 et 22, publication sur étiquette.

## 2.4.2

Revu sur les 7 658 mails réels de la sauvegarde AMBS, comparés un par un à ce que l'ancien service a fait (journal d'exécution, champs, biens, destinataires).

- Nouvelles variantes lues : ParuVendu (l'identifiant Immofacile est dans la réf. pro), Bien'ici location, bailleur et appel manqué, Green-Acres « Nouveau contact pour l'agence », SeLoger Luxe, eKonsilio transféré, Châteaux pour tous (hébergeur tiers), Stonimmo / Annonce-Immobilier, Adapt (formulaire de recherche : l'adresse est celle du prospect), Jestimo rendez-vous et « démarchage hors horaires autorisé ».
- Mail de portail repassé par une boîte de l'agence (« TR: » depuis la boîte des non-traités) : le portail est reconnu au texte.
- Bien'ici : « immo-facile-405876 » dans at_id_compte est le compte de l'agence, plus un identifiant de bien.
- Identifiant Immofacile (8 chiffres) caché dans une référence (« 985_985_60945370 ») essayé en premier.
- Rapprochement : une preuve faible (référence tronquée, segment, critères) doit avoir un fait qui distingue le bien (prix, surface, code postal, ville) ; une ville ou un type différents la bloquent sauf si deux faits distinctifs concordent. « 32562-32562 » vaut la référence complète. Loyer comparé au prix du bien loué.
- Prix : le capital social en bas de mail n'est plus pris pour un prix ; loyer « 600 €/mois » lu à part.
- Noms : le mot en capitales est le nom (« MATHIEU Jérémie ») ; « Nom : Jean Dupont » est découpé ; téléphone donné dans le message récupéré.
- Mails directs : envoi en nombre, [SPAM], codes de connexion, sociétés sans référence → « à trier » ; mail direct sans bien reconnu → « à trier ». Réponse d'un particulier (« Re: ») avec la référence dans la citation → relance.
- Signalé « à vérifier » : démarchage (photographe, brochures, référencement…), message de test, prospect qui dit avoir déjà trouvé.
- Immofacile : relecture du contact après écriture ; ce qui n'a pas été pris est signalé (l'ancien service n'a jamais retrouvé origin / group / phone à la relecture). Contact sans négociateur rattaché à celui du bien.

## 2.4.1

- Adaptateur Immofacile aligné sur la documentation OpenAPI V2 : consentement (reason 64 caractères max, consent_date, proofs[] rangées dans Documents confidentiels/Consentement), valeurs des critères par `/criterias/product/{id}/values` (code « model »), clés XML lues sur le site (NbPieces ou NbPiece), recherche de biens avec `?fetch=` (biens complets sans appel de détail), contacts triés du plus récent (createdAt, mobilePhone), suivi sans corps (409 = déjà suivi), note du prospect en action si un type d'action est réglé, recherche d'acquéreur (`/customers/{id}/search-requests`) pour les leads « recherche ».

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

## Historique de la branche de maintenance

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
