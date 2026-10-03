# Téléphone seul et actualisation — 2.14.13

Un contact avec téléphone seul peut être créé dans Immofacile. Sans téléphone ni
e-mail, aucune création n'est planifiée et l'adaptateur refuse tout appel POST.

La fiche CRM reçoit `email-indisponible-<empreinte>@email-indisponible.invalid`.
L'empreinte est stable par site et téléphone ; le domaine est non distribuable.
L'extraction, le lead et le dossier conservent l'absence d'e-mail réel : le
placeholder n'est pas utilisé pour les notifications de la pipeline.

La recherche par téléphone précède la création. Le POST avec téléphone et
`check_duplicate:true` protège également une course avec une autre création.
Un 409 est résolu par e-mail exact, puis téléphone si l'e-mail était provisoire.
Une vraie adresse ultérieure remplace uniquement une adresse provisoire reconnue,
après recherche e-mail puis téléphone. Un e-mail réel existant n'est pas écrasé.

`dzf_leads_reprendre_sans_email` reprend depuis la date ISO les demandes avec bien,
téléphone valide, sans e-mail et sans fiche CRM, anciens modes inclus, mode ombre
exclu. Il utilise `traiterMail` sans appeler la préparation ou l'envoi des mails.
Il relit téléphone, liaison au bien et affectation ; les autres erreurs CRM restent
visibles dans le rapport. Une écriture ambiguë ancienne bloque la reprise du cas.
Avancement stocké dans dzf_cache, 80 minutes par passe. `termine:true`, `reste:0`
indiquent la fin ; `a_verifier:0` indique l'absence d'anomalie constatée.

`dzf_leads_actualiser_pages` sauvegarde les layouts dans dzf_cache et configure les
blocs de données AMBS à 15 secondes. Il laisse les formulaires inchangés.
Le bloc de table de lecture émet un signal tenant après son COMMIT, sans données
personnelles. dysizz-ui 3.14.4 regroupe ces signaux et relit les sources en contournant
leur cache, avec vérification normale des droits. La minuterie reste un secours.

Les tests locaux couvrent les règles de création, remplacement, reprise, identité,
liaison, affectation, et un Chromium vérifie connexion unique, rafales et saisie.
Ils ne prouvent pas le déploiement sur l'instance ni l'acceptation réelle du POST
par Immofacile ; le rapport du Run JS apporte cette vérification.
