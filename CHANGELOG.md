# Journal des versions

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
