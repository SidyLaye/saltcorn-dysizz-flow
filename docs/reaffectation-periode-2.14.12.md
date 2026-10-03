# Réaffectation depuis une date

Bloc administrateur `dzf_leads_reaffecter_periode`, exécuté en arrière-plan. Le Run JS fourni fixe le début au **1er août 2026 06:00 Europe/Paris**, soit **2026-08-01T04:00:00Z**, et la fin au premier lancement.

- Sélection des demandes avec contact CRM et bien, y compris les lignes du mode ancien. Les non-leads et le mode ombre sont exclus.
- Une seule cible par contact : sa demande avec bien la plus récente. Une demande plus récente apparue pendant le rattrapage fait ignorer la cible ancienne.
- Identité vérifiée par e-mail ou, faute d'e-mail, par téléphone. Le propriétaire vendeur du bien est écarté.
- Négociateur relu sur le bien dans Immofacile. L'agence vient du bien ou de l'annuaire du négociateur ; si inconnue, elle n'est pas inventée et reste signalée.
- PATCH des seules différences, puis relecture du contact et contrôle de la liaison au bien. Une liaison manquante est ajoutée puis vérifiée.
- Le rapport contient les contacts confirmés, les modifications, les cas déjà corrects et tous les cas à vérifier. Les demandes sans contact CRM sont comptées, pas créées par ce rattrapage d'affectations.
- Ni traitement complet de mail, ni IA, ni consentement, ni SMTP. Ce bloc ne marque pas les mails lus.

## Durée et reprise

Le curseur et le rapport sont conservés dans `dzf_cache`, par tenant et préfixe. Une passe dure au maximum environ 80 minutes (plus l'appel en cours) ; l'outil arrière-plan impose également sa limite générale de deux heures. Si `termine:false`, relancer le même Run JS reprend le travail. Les points de reprise sont écrits tous les dix contacts et en fin de passe ; un lot relu après un arrêt reste idempotent. Les erreurs traitées sont conservées pour diagnostic, sans être automatiquement rejouées après une fin complète.

Rapport `reaffectation-depuis-20260801-06h.json` dans Fichiers :

- `termine:true` et `reste:0` : sélection entièrement parcourue.
- `a_verifier:0` : aucun cas en erreur ni agence inconnue parmi les contacts parcourus.
- `demandes_sans_contact_crm` : demandes exclues faute de fiche, distinctes des affectations vérifiées.
- `emails_envoyes:0` : ce bloc n'envoie aucun e-mail.

Les écritures déjà confirmées ne sont pas refaites lorsque le rapport est terminé. Des erreurs demandent une analyse ciblée.

## Nouveaux leads

La version 2.14.12 contrôle aussi la création, le conflit 409 et la mise à jour des contacts. Un contact retrouvé après 409 est réaffecté si nécessaire. Si l'agence ou le négociateur ne sont pas relus après création, le résultat n'est pas déclaré réussi, mais l'identifiant réel reste conservé pour éviter une nouvelle création. Les liaisons contact/bien sont relues également.
