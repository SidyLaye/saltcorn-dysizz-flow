# Réaffectation au négociateur du bien demandé

Règle demandée par l'utilisateur : un contact existant est réaffecté au négociateur du bien retrouvé pour la demande, même s'il avait déjà un autre responsable.

- Le plan compare le négociateur et l'agence du contact aux valeurs de la demande.
- Seules les valeurs différentes sont écrites ; l'identité du contact reste traitée selon les règles existantes.
- Sans bien retrouvé ou sans négociateur déterminé, aucune réaffectation n'est prévue.
- Après PATCH, la fiche est relue. Un négociateur ou une agence non retrouvés font apparaître une erreur de réaffectation non confirmée.
- Aucun envoi d'e-mail supplémentaire n'est déclenché par ce changement.

Une fiche contact dispose d'un responsable : si le même prospect demande plusieurs biens avec plusieurs négociateurs, le responsable devient celui de la dernière demande traitée. Les liens du contact vers ses autres biens sont conservés. Une reprise ancienne peut également changer ce responsable ; les reprises de période existantes sont triées chronologiquement.

Publication GitHub ne signifie pas installation : recharger dysizz-flow 2.14.11 sur Saltcorn pour appliquer la règle aux nouveaux traitements. Aucun rattrapage historique n'est lancé automatiquement par la mise à jour.
