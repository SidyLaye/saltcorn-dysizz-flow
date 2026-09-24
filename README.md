# dysizz-flow

Des **blocs workflow** pour Saltcorn, comme les nœuds de n8n : chaque bloc fait une chose (lire une table, appeler une API, lire des flux RSS, relever une boîte mail, envoyer un WhatsApp, demander à une IA…) et s'enchaîne avec les autres dans l'éditeur de workflows natif de Saltcorn.

- **Sans code** : chaque bloc a son formulaire de réglages. Les réglages acceptent des `{{variables}}` du contexte (`{{lignes}}`, `{{item.titre}}`, `{{user.email}}`).
- **Avec code** : chaque bloc montre son code. Tu peux partir d'un bloc intégré ou créer les tiens dans l'**atelier** (réglages + code + essai), sans redémarrer Saltcorn.
- **Modèles** : des workflows prêts à installer (flux RSS → table, boîte IMAP → table, rappel du matin, webhook → table, export CSV, résumé IA, alerte Telegram, synchro d'API, classement IA, offres France Travail).

C'est la partie « back » du kit. Le front (design, blocs UI) est [dysizz-ui](https://github.com/SidyLaye/saltcorn-dysizz-ui).

## Les blocs (39)

| Catégorie | Blocs |
|---|---|
| Données | chercher, compter / additionner, ajouter (une ou une liste), ajouter ou mettre à jour (sans doublon, par lots de 500), modifier, supprimer (refuse un filtre vide) |
| Transformer | définir des valeurs, transformer une liste, filtrer, enlever les doublons (même contre une table), trier et limiter, découper en lots, texte depuis un modèle, dates, JSON, CSV, HTML → texte |
| Réseau | HTTP (secrets en variables d'env., réessais sur 429/5xx), flux RSS/Atom/YouTube en parallèle, identifiant de chaîne YouTube |
| Messagerie | lire une boîte IMAP (lecture seule, reprise au dernier UID), envoyer un mail, notifier dans Saltcorn, Telegram, WhatsApp Cloud API |
| IA | générer un texte, classer, résumer — tout modèle compatible OpenAI (Ollama et LiteLLM par défaut, rien ne sort du serveur) |
| Services | France Travail, écrire un fichier, lire un fichier |
| Contrôle | pause, vérifier une condition, verrou (une exécution à la fois, même sur plusieurs serveurs), cache, limite de débit, Redis, journal, code JavaScript |

Réglages communs à tous les blocs : **sortie** (nom de la variable du résultat), **en cas d'erreur** (arrêter ou continuer) et **délai max**.

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
- Secrets en variables d'environnement, jamais en base. Les droits de la table sont respectés quand un utilisateur lance un bloc.
- Les erreurs sont notées dans `/dysizz-flow/journal`. Pour suivre un workflow pas à pas, utilise les « Workflow runs » de Saltcorn.

## Variables d'environnement utiles

`REDIS_URL` (ex. `redis://redis:6379`), `DZ_MAIL_PASSWORD`, `FT_CLIENT_ID`, `FT_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `OPENAI_API_KEY` (seulement si tu n'utilises pas Ollama).

## Développer

```bash
cd tools && npm ci && node build.mjs
cd .. && NODE_PATH=tools/node_modules node tests/run.cjs
```

Voir [docs/CREER-UN-BLOC.md](docs/CREER-UN-BLOC.md). `index.js` est généré : ne le modifie pas à la main.

Licence MIT.
