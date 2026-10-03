# Ajout RGPD de l'atelier intégré au module

Origine : bloc `leads_crm_conformite`, sauvegarde du 2 octobre 2026 à 23:45.
Le workflow appelle ce bloc avant et après l'écriture CRM. Le correctif conserve ces appels ; avant une exécution CRM réelle, il est sans effet. Après, il utilise le client CRM du module (authentification renouvelée, délais bornés) et ne rejoue pas les écritures déjà tentées.

Corrections :

- Sans contact confirmé, aucune écriture RGPD et aucune fausse erreur « aucun contact ».
- `consentementVerifie:true` ne signifie pas que le consentement est actif : la valeur doit également être vraie et est relue à distance.
- Les deux écritures sont indépendantes : consentement anti-démarchage avec preuve, consentement RGPD `rgpd_consent`, conformité documentée `conformity:1`.
- HTTP 204 ne suffit pas : seules les valeurs relues permettent de déclarer une confirmation.
- Un contact explicitement non conforme (valeur 2 relue) n'est pas converti automatiquement.
- Un ancien projet n'appartenant plus aux projets du contact n'est pas réutilisé. Le plan crée le projet correspondant au contact et à la demande.
- La migration sauvegarde le bloc de l'atelier avant de le remplacer par un appel au bloc natif. Elle refuse tout code modifié depuis la sauvegarde vérifiée.

## Limite réelle observée

L'API de production renvoie `rgpd_consent`, mais ne renvoie pas `conformity`, malgré son écriture documentée. Le booléen `rgpd` ne doit pas être assimilé au statut `conformity`. Dans ce cas, la confirmation de conformité reste **à vérifier** ; elle n'est pas déclarée réussie. Les reprises automatiques ne répètent pas ce cas indéfiniment.

Ce correctif n'envoie aucun e-mail. La migration ne rejoue aucun lead. Le module mis à jour corrige les prochains traitements ; le bloc `dzf_leads_reparer_selection_crm` permet une reprise CRM ciblée en arrière-plan, sans SMTP.
