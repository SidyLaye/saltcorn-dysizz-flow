# dysizz-flow

Des **blocs workflow** pour Saltcorn, comme les nœuds de n8n : chaque bloc fait une chose (lire une table, appeler une API, lire des flux RSS, relever une boîte mail, envoyer un WhatsApp, demander à une IA…) et s'enchaîne avec les autres dans l'éditeur de workflows natif de Saltcorn.

- **Éditeur visuel** (`/dysizz-flow/workflows`) : tes workflows en schéma, blocs reliés par des flèches, sans code ou en code au choix.
- **Sans code** : chaque bloc a son formulaire de réglages. Les réglages acceptent des `{{variables}}` du contexte (`{{lignes}}`, `{{item.titre}}`, `{{user.email}}`).
- **Avec code** : chaque bloc montre son code. Tu peux partir d'un bloc intégré ou créer les tiens dans l'**atelier** (réglages + code + essai), sans redémarrer Saltcorn.
- **Catalogue** : 18 workflows prêts à installer (flux RSS → table, boîte IMAP → table, rappel du matin, webhook → table, export CSV, résumé IA, alerte Telegram, synchro d'API, classement IA, offres France Travail, surveillance de sites, santé de la plateforme, veille CVE, file de travaux).
- **Points d'API** : tes propres adresses publiques `/dzf/api/<nom>` qui lancent un workflow, protégées par jeton ou signature HMAC, avec limite de débit.
- **Coffre** : secrets chiffrés en base (AES-256-GCM), jamais réaffichés.
- **Supervision** : exécutions, erreurs, temps de réponse par bloc, workflows, état du serveur.
- **Extensible** : un autre plugin peut apporter ses blocs (export `dysizz_flow_blocks`), et tes blocs perso sont versionnés (retour arrière).

C'est la partie « back » du kit. Le front (design, blocs UI) est [dysizz-ui](https://github.com/SidyLaye/saltcorn-dysizz-ui).

## Les blocs (201)

| Catégorie | Blocs |
|---|---|
| Données (9) | chercher, obtenir une ligne, compter / additionner, regrouper (stats), ajouter, ajouter ou mettre à jour (par lots de 500), modifier, supprimer (refuse un filtre vide), SQL en lecture seule (transaction read-only + délai max) |
| Transformer (21) | définir, transformer / filtrer / trier / dédoublonner / découper une liste, regrouper et compter, joindre deux listes, ce qui a changé (ajouts, retraits, modifs), aplatir, N-ième élément, garder / renommer des champs, texte depuis un modèle, regex, outils texte (slug, couper…), calcul sûr, dates, JSON, CSV, XML, HTML → texte |
| Réseau & API (7) | HTTP (réessais sur 429/5xx), GraphQL, télécharger un fichier, lire une page web, vérifier la signature d'un webhook (hex, base64, Stripe), flux RSS/Atom/YouTube en parallèle, identifiant de chaîne YouTube |
| Messagerie (10) | IMAP (lecture seule, reprise au dernier UID), mail, notification Saltcorn, Telegram, WhatsApp, Slack, Discord, Teams, push mobile ntfy, SMS Twilio |
| IA (7) | générer, classer, résumer, extraire des champs, traduire, vecteur (embedding), plus proches par le sens — tout modèle compatible OpenAI (Ollama / LiteLLM par défaut) |
| Sécurité (13) | hacher / HMAC, chiffrer (AES-256-GCM), JWT, générer (UUID, jeton, mot de passe), mot de passe fuité (k-anonymat, rien n'est envoyé en clair), CVE (NVD), audit des en-têtes HTTP, certificat TLS (expiration), SPF / DMARC / MX, masquer les données perso, détecter des secrets, réputation d'IP, ports ouverts |
| Surveillance (7) | site en ligne (code, temps, texte attendu, en parallèle), DNS, port TCP, santé du serveur, santé de Postgres, battement de cœur (Uptime Kuma, Healthchecks…), état des workflows |
| Logs & métriques (6) | métrique (écrire, lire moyenne / min / max), alerte sans spam (une fois par période, puis « rétabli »), journaux Saltcorn, envoi vers Loki / Grafana, purge des vieilles lignes |
| Tâches & planification (9) | lancer un workflow, pour chaque élément (en parallèle borné), planifier plus tard (avec clé qui remplace), planificateur, file d'attente (ajouter, prendre, terminer — Redis ou table), lire / créer un agenda ICS |
| Contrôle (11) | aiguiller, déjà traité ? (idempotence), disjoncteur, pause, vérifier, verrou (multi-serveurs), cache, limite de débit, Redis, journal, code JavaScript |
| Services (4) | France Travail, emplois multi-sources, écrire / lire un fichier |
| Stockage (11) | S3 (AWS, OVH, Scaleway, MinIO, R2… : lister, envoyer, récupérer, supprimer, copier, lien temporaire), ZIP (créer, ouvrir, anti-bombe), WebDAV (Nextcloud, kDrive…), IPFS (Pinata ou nœud Kubo), base64 / empreinte |
| Documents (8) | PDF (créer depuis Markdown avec tableaux et images, sans service externe ; convertir HTML / page web / Office et fusionner avec Gotenberg), extraire le texte (PDF, Word, Excel, OCR avec Tika), Excel (écrire, lire), Word (créer, lire, remplir un modèle {{champ}}), QR code (lien, Wi-Fi, carte de visite, virement SEPA ; SVG et PNG), Markdown → HTML |
| IA avancée (8) | créer une image, transcrire un audio, lire à voix haute, vision et OCR (description, texte, champs JSON), agent avec outils (tes tables, tes workflows, le web), découper un texte, répondre avec tes documents (RAG), traduction DeepL / LibreTranslate |
| Blockchain (10) | Ethereum et compatibles (Polygon, Base, Arbitrum, Optimism, BNB, Avalanche, Gnosis, réseaux de test) : solde et jetons ERC-20, lire un contrat, événements, état d'une transaction, envoyer (crypto, jeton, appel de contrat, avec plafond), signer / vérifier un message, créer un portefeuille (clé dans le coffre), appel RPC libre ; Bitcoin (mempool.space) ; cours (CoinGecko) |
| DevOps (6) | GitHub, GitLab, Docker (conteneurs, journaux, stats, redémarrer), Dokploy, Kubernetes, Cloudflare (DNS dynamique, cache) |
| OVHcloud (14) | créer une clé d'accès (lien de validation), compte et services qui expirent, domaines (expiration, DNS, verrou, changer les serveurs DNS), enregistrements DNS (lister, créer ou mettre à jour sans doublon, supprimer, vérification publique), **sous-domaine en une fois** (DNS + hébergement + SSL), zone (export / import BIND, DNSSEC, rafraîchir), redirections web, e-mails MX Plan (boîtes, mots de passe depuis le coffre, redirections, répondeur), hébergement web (multisite, SSL, bases), VPS (état, redémarrer, snapshots), serveurs dédiés, Public Cloud (instances), factures et commandes non payées, appel libre signé |
| Leads immobiliers (6) | lire un mail de portail sans IA (30 portails : Leboncoin, SeLoger, Green-Acres, Figaro, Bien'ici, Properstar, French-Property, Rightmove, sites d'agence AC3…), traiter un mail (bien, agence, contact, consentement, destinataires), retrouver le bien (référence, variantes, critères, contradiction = rejet), qui reçoit (règles, congés, mi-temps), absents de la semaine, consulter le CRM — Immofacile ou Salesforce, mode ombre par défaut |
| Données externes (10) | autre base PostgreSQL (lecture seule par défaut), Meilisearch / Elasticsearch, Qdrant, ClickHouse, InfluxDB, Supabase, Airtable, Notion, Google Sheets (compte de service), Baserow / NocoDB |
| Objets connectés (3) | MQTT (publier, écouter), WebSocket, Home Assistant |
| Pratique (10) | météo (Open-Meteo), adresse ↔ GPS (BAN, OpenStreetMap), itinéraire et distance, jours fériés et vacances scolaires, fiche entreprise (SIRENE), taux de change (BCE + franc CFA), Wikipédia, vérifier IBAN / SIRET / TVA / carte, prochaines dates cron, Stripe |
| Messagerie + | Matrix, Mattermost / Rocket.Chat / Zulip, push Gotify / Pushover / Signal |

Réglages communs à tous les blocs : **sortie**, **en cas d'erreur** (arrêter ou continuer), **délai max**, **essais** et **pause entre essais** (pause qui double à chaque fois ; pas de nouvel essai si l'erreur est définitive).

## Utiliser un bloc

1. Paramètres → Déclencheurs → Créer, action **Workflow**.
2. Ajoute des étapes. Dans la liste des actions, les blocs commencent par `dzf_` et tes blocs perso par `dzf_u_`.
3. Chaque étape range son résultat dans le contexte (réglage « sortie »). L'étape suivante le lit avec `{{nom}}`.
4. Pour les conditions et les boucles, utilise ce que Saltcorn fait déjà : « Only if », « next step », les étapes ForLoop, UserForm et WaitUntil.

Un bloc marche aussi seul : comme déclencheur sur une table, en tâche planifiée, ou comme bouton dans une vue.

## Tenir la charge

- Traitement par lots, pas de requête dans une boucle : l'upsert lit les clés existantes par paquets de 500.
- Idempotent : dédoublonnage par clé, reprise au dernier UID IMAP. Relancer un workflow ne crée pas de doublon.
- Verrou (`dzf_verrou`) et limite de débit (`dzf_limiter`) partagés entre serveurs grâce à Redis si `REDIS_URL` est défini. Sinon, une table les remplace.
- Délai max sur chaque bloc. Parallélisme borné pour les flux.
- Réessais avec pause croissante, disjoncteur pour les services fragiles, idempotence (`dzf_idempotence`) pour les webhooks reçus deux fois.
- Files d'attente et « pour chaque » en parallèle borné : un gros volume se découpe en travaux, traités par un ou plusieurs serveurs.
- Métriques comptées en mémoire et écrites une fois par heure (`dzf_metriques`) : pas d'écriture en base à chaque exécution.
- Secrets : variable d'environnement d'abord, sinon le coffre chiffré. Jamais de mot de passe ni de jeton de compte dans le contexte d'un workflow (filtrés à la lecture).
- Les droits de la table sont respectés quand un utilisateur lance un bloc. Le SQL passe par une transaction en lecture seule.
- Tables du plugin créées au premier usage, et complétées toutes seules quand une nouvelle version ajoute un champ.
- Les erreurs sont notées dans `/dysizz-flow/journal`, la vue d'ensemble dans `/dysizz-flow/supervision`. Pour suivre un workflow pas à pas, utilise les « Workflow runs » de Saltcorn.

## Écouteurs de boîtes mail (temps réel)

`/dysizz-flow/ecouteurs` : une boîte IMAP reste écoutée (IDLE, relève de secours toutes les 5 minutes). Chaque mail est rangé une seule fois dans la table choisie, puis l'événement **DzfMailRecu** est émis : un workflow « Quand : DzfMailRecu » le traite (les champs du mail sont dans le contexte : `id`, `objet`, `expediteur`…). Lecture seule par défaut (rien n'est marqué lu ni déplacé). Le curseur (dernier UID) est gardé dans `dzf_ecouteurs` : pas de parcours de toute la table à chaque relève. Les écouteurs tournent dans le processus principal de Saltcorn et suivent la table (un changement est pris en compte en 30 s).

## Points d'API (exposition)

`/dysizz-flow/api` : un point = un nom, un workflow, une protection (aucune, jeton, HMAC), une limite de requêtes par minute et par IP, et la variable du contexte à renvoyer en JSON.

```bash
curl -X POST https://ton-saltcorn/dzf/api/contact -H "X-Api-Key: $JETON" -H "Content-Type: application/json" -d '{"nom":"Awa"}'
```

Le workflow reçoit `corps`, `corps_brut`, `query`, `entetes` (sans cookies ni autorisation), `ip`, `methode`. Il peut mettre `statut_http` dans son contexte. Par défaut il tourne avec les droits d'un visiteur ; tu peux choisir un compte (idéalement un compte robot dédié).

## Apporter des blocs depuis un autre plugin

```js
module.exports = {
  sc_plugin_api_version: 1,
  dysizz_flow_blocks: [{
    name: "dzx_bonjour", label: "Dire bonjour", category: "Extensions", output: "bonjour",
    params: [{ name: "nom", label: "Nom", required: true }],
    run: async (p, contexte, api) => `Bonjour ${p.nom}`,
  }],
};
```

Les noms commencent par `dzx_`. Ces blocs ont tout ce qu'ont les blocs intégrés : `{{variables}}`, essais, délai max, journal, métriques, `api.secret()`.

## Variables d'environnement utiles

`DZF_CLE_COFFRE` (clé du coffre — garde-la de côté), `REDIS_URL` (ex. `redis://redis:6379`), `DZ_MAIL_PASSWORD`, `FT_CLIENT_ID`, `FT_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `OPENAI_API_KEY` (seulement si tu n'utilises pas Ollama).

## Développer

```bash
cd tools && npm ci && node build.mjs
cd .. && NODE_PATH=tools/node_modules node tests/run.cjs
```

Voir [docs/CREER-UN-BLOC.md](docs/CREER-UN-BLOC.md). `index.js` est généré : ne le modifie pas à la main.

Licence MIT.
