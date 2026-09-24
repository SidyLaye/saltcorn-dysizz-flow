# Journal des versions

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
