# dysizz-flow — blocs workflow pour Saltcorn

À lire d'abord (communs aux trois dépôts) : `saltcorn-dysizz-ui/docs/VISION.md`,
`docs/DECISIONS.md` et `docs/AUDIT.md` du dépôt `saltcorn-dysizz-ui`.

## Stack
- Plugin Saltcorn **1.6.2**, Node ≥ 18. 201 blocs (`src/blocks/`), moteur `src/engine.js`,
  coffre `src/vault.js` (AES-256-GCM, clé `DZF_CLE_COFFRE`), points d'API `src/expose.js`
  (`/dzf/api/<nom>`), écouteurs IMAP `src/ecouteurs.js`, Redis optionnel (`REDIS_URL`).
- Créer un bloc : `docs/CREER-UN-BLOC.md`.

## Commandes
- Build : `cd tools && npm ci && node build.mjs` (même résultat lancé depuis la racine :
  `absWorkingDir` fixe les chemins écrits dans `index.js`).
- Tests : `cd tools && npm test` (ou `node tests/run.cjs` depuis la racine).

## Règles
- `index.js` est GÉNÉRÉ depuis `src/` et `client/` : jamais modifié à la main, toujours commité après build.
- Nouvelle version : `package.json` + `CHANGELOG.md`.
- **Dépôt public** : aucun secret, IP, domaine interne ni détail de faille exploitable.
- Secrets : on ne manipule que des noms (variable d'environnement, puis coffre).
- Tout appel externe : délai maximal et reprise ; tâche `Often` (~288/j) paginée, idempotente, sous verrou.
- Instance réelle : analyse, puis simulation sans écriture, puis écriture.

## Pièges
- Multi-tenant : tout nom de variable ou code venant d'un réglage passe par `src/garde.js`
  (secrets du serveur jamais lisibles ; hors racine, `DZF_ENV_PARTAGEES` et bac à sable). Ne jamais lire
  `process.env[nom]` ni faire `new Function` sur un réglage ailleurs que dans ce fichier.
- Les versions 2.5.0 / 2.6.0 et `dysizz-leads` existent sur le PC de Sidy : vérifier qu'elles
  sont poussées avant de modifier ce dépôt (AUDIT F6).
- `tryCatchInTransaction` et `forupdate` ne protègent rien sur les requêtes HTTP tant que la
  racine est servie sur un sous-domaine (`saltcorn-dysizz-ui/docs/SCALING.md` §6).
