# Journal des versions

## 2.14.14

### Corrigé
- Agence d'un lead : quand le CRM ne renvoie pas l'agence du bien, on prend celle du négociateur du bien avant de
  regarder la boîte qui a reçu le mail. Sans ce repli, les leads reçus sur la boîte centrale partaient tous chez
  l'agence qui la déclare, quel que soit le bien. Test : `tests/agence.test.cjs`.

### Ajouté
- « Leads : corriger les affectations CRM d'une période » : option **Simuler** (cochée par défaut, n'écrit rien,
  rapport seulement) et option **agence erronée** (id CRM) : seuls les contacts encore rangés dans cette agence
  sont corrigés, et seulement leur agence ; nos leads de la période qui portaient son nom sont alignés.
  Attention : un déclencheur existant sans ces réglages simule désormais au lieu d'écrire.
  Test : `tests/reaffectation-cible.test.cjs`.

## 2.14.2

### Corrigé
- « Qui reçoit un lead » (`dzf_lead_qui_recoit`, table `vue_routage`) : une personne inactive sans remplaçant n'est plus
  marquée « remplacé » ; elle est marquée `inactif` (colonne écrite si elle existe). « Remplacé » = quelqu'un reçoit
  à sa place (congé, mi-temps, départ avec remplaçant), ou personne active qui ne reçoit pas elle-même.

## 2.14.1

- Gabarits et lecture par l'IA :
  - chaque valeur doit avoir la forme de son champ (e-mail, téléphone, nom, ville, code postal, type, prix, surface, pièces, référence) ;
  - un motif doit s'appuyer sur un libellé du mail ;
  - une valeur invalide est refusée à l'apprentissage et à la lecture. Cela évite les erreurs vues dans les anciens gabarits : « Bonjour » lu comme ville, « contact » comme nom, numéro d'assistance du portail comme téléphone.
- Valeurs lues par un gabarit ou par l'IA : mêmes contrôles que les règles (numéros de l'équipe, de l'agence ou du portail ; adresses de l'agence ; relais).
- Nouvelle page « Leads : suivi en direct » (/dysizz-flow/leads/suivi, administrateur) :
  - chiffres par statut ;
  - erreurs d'IA et envois en échec ;
  - erreurs en tête, recherche par e-mail, nom ou référence ;
  - détail de chaque lead avec l'origine de chaque valeur ;
  - rechargement toutes les 30 s.

## 2.14.0

Vérité des mails : chaque mail d'AMBS (8 675) a été lu et comparé au moteur, portail par portail, champ par champ.
Le vrai bien de chaque mail est établi indépendamment du moteur, par la référence présente dans le mail, confirmée par le catalogue Immofacile.

### Bien : trouver le BON bien
- Recherche par critères refaite. Chaque bien du catalogue est noté :
  - le prix est obligatoire, avec au moins un autre fait concordant (surface, pièces, commune ou code postal) ;
  - le type ne filtre plus : « Propriété » sur Leboncoin est une « Maison » dans le CRM ;
  - le bien doit être seul en tête, sinon le lead part en non automatisé avec les biens possibles indiqués.
- Référence donnée mais absente du catalogue (annonce retirée, bien vendu) : il faut deux faits concordants en plus du prix. Le département seul ne suffit jamais. Un prospect était sinon rattaché à un autre bien au même prix.
- Toutes les références du mail sont essayées : celle de l'agence, le mandat, celle du portail, la clé du lien Adapt, l'identifiant Immofacile. L'ordre reste celui de la procédure décrite au client (complète, sans le dernier caractère, segments de droite à gauche), puis les paires de segments.
- Force de la preuve selon la source :
  - identifiant de diffusion (8 caractères ou plus) : un écart toléré et signalé ;
  - référence de l'agence : forte, même courte ;
  - pour une référence exacte de l'agence, un lieu différent (commune voisine affichée) est signalé, pas rejeté.
- Lieu approximatif (Leboncoin, Green-Acres, Rightmove, French-Property, Propriétés le Figaro) : un désaccord de ville ou de code postal n'est jamais une contradiction.
- Surface : jamais celle du terrain, du jardin ou du parc (« JARDIN 2000 M2 », « sur un terrain de 1 390 m² ») ; sauf si le bien est un terrain.
- Projet de recherche tiré du bien : valeurs exactes du bien, sans marge (règle d'AMBS).

### Lecture des portails
- Leboncoin : prix lu dans les réponses sans ligne « Référence » ; ville de l'annonce marquée approximative.
- Green-Acres :
  - la carte ☎/✉ de l'acheteur passe avant un numéro de négociateur cité dans le fil ;
  - la carte de l'agence n'est jamais prise ;
  - « 1234567a-1551 » donne la référence 1551 ;
  - le numéro de mandat est essayé aussi.
- Rightmove : la mention légale « Firm Reference No. » n'est plus prise pour la référence ; « 12345_12345_1234 » donne 1234.
- Figaro : « Annonce 1234-56789 » donne la référence 1234.
- Giraffe : « 1234_Nom » donne 1234.
- Kyero : « réf/id : A/B » est lu.
- Superimmo : prix, ville et code postal lus.
- JamesEdition : nom, e-mail et téléphone du prospect lus.
- Bien'ici : bloc « Rappel de l'annonce » collé au message.
- Ma-Propriété : plus jamais de prix pris dans une adresse web.
- Texte : espace des milliers abîmé par l'encodage (« 136���000 € ») et champs collés (« VillePrice: », « m²86460 ») réparés avant lecture.

### Contact
- Téléphone : aucun indicatif inventé.
  - « 07956288684 » donne +44 ;
  - un numéro à 9 chiffres sans indicatif prend celui du contexte (pays indiqué, e-mail, agence du Sénégal), sinon il reste tel qu'écrit, avec une remarque.
- Civilité retirée du nom (« M Habitat Square », « Mr Andrew ») ; une initiale seule n'est pas un prénom.
- Nom de société affiché (« A DUPONT RENOVATION SERVICES ») : le nom vient de la signature (« Léa MARTIN 06… Envoyé depuis… »).

### Tri
- Un membre de l'équipe qui écrit depuis une adresse personnelle (nom affiché = une personne des réglages) : interne, jamais un prospect.
- Hameçonnage (« a partagé un document », « Expire le », fausse marque WeTransfer, lien vers un autre site) : alerte, jamais transmis.
- Démarchage mieux reconnu (« fondateur de », « nous transformons vos photos… ») ; un acheteur qui parle de la visite virtuelle n'est plus pris pour un démarcheur.

### Mesures (8 675 mails, avant → après)
- Bon bien : 4 531 → 4 570.
- Bien présent dans le mail mais non trouvé : 57 → 7. Les 7 restants sont ambigus pour de bon : même bien sous deux mandats, ou fil de réponses sans le bien.
- Mauvais bien : 2 → 0. Le cas restant compté par l'outil est un faux écart de la vérité, relu à la main.
- Leads complets (contact + bon bien) : 4 507 prêts. Les 18 autres sont non automatisés pour une raison vérifiée :
  - pas d'e-mail ;
  - démarchage ;
  - message de test ;
  - nouvel expéditeur ;
  - agence sans négociateur par défaut.

## 2.13.9

Corrections venues de l'audit complet des 8 675 mails reçus par AMBS. Pour chaque mail, on a comparé trois choses : le contenu du mail, ce que l'ancien système a extrait et écrit dans Immofacile, et ce que le moteur écrirait.
- Téléphone : un numéro de l'équipe ou de l'agence n'est plus jamais pris pour celui du prospect. C'était le cas pour :
  - la signature d'une négociatrice citée dans une relance ;
  - le numéro de l'agence dans l'accusé de réception Green-Acres ;
  - le standard d'un portail en bas de page ;
  - un numéro de TVA ;
  - les numéros bidon (06 00 00 00 00).
  - Les numéros de l'équipe sont lus dans les fiches des personnes. Un réglage « téléphones exclus » permet d'en ajouter d'autres.
- E-mail :
  - une adresse collée au mot suivant (« …@gmail.comdans ») est coupée à la bonne extension ;
  - une adresse « contact@ » ou « info@ » donnée par le prospect sous un libellé e-mail est gardée.
- Noms :
  - la casse est corrigée avant l'écriture dans le CRM (« FONTAINE », « nicolas » deviennent « Fontaine », « Nicolas ») ;
  - un pseudo avec des chiffres n'est jamais un nom ;
  - un seul mot recopié en prénom et en nom n'est rangé qu'une fois ;
  - les mots de service (« secrétariat », « comptabilité ») ne sont jamais des noms.
- Contact sans e-mail : Immofacile ne crée pas de contact sans e-mail, donc le lead passe « à vérifier » au lieu d'échouer.
- Lead non automatisé (à vérifier, à trier) : rien n'est écrit dans le CRM, comme dans l'ancien système. Le réglage « écrire aussi les leads à vérifier » permet de changer ce comportement.
- Sources :
  - CessionPME : une « prise de contact sur l'annonce » est un lead ;
  - Huisenaanbod : le mail est lu dans sa version HTML quand le texte brut n'est qu'un gabarit vide ;
  - création de compte sur un site d'agence, avec le client mais sans bien : transmise à la main au lieu d'être ignorée ;
  - Properstar : le nom est lu dans les demandes de visite.

## 2.13.8

- Nouveau bloc « Leads : vérifier et corriger les gabarits d'un ancien système ». Il vérifie chaque gabarit sur les vrais mails reçus, champ par champ.
  - Pour chaque gabarit actif, il cherche les mails qu'il reconnaît et applique chacun de ses motifs.
  - Il compare avec une lecture de référence du même mail : celle des règles quand elles lisent tout le mail, sinon celle de l'IA (nombre d'appels plafonné).
  - Il contrôle aussi chaque valeur : e-mail valide et hors agence, téléphone valide, nom qui n'est ni un rôle ni un mot vide, référence non vide.
  - Un champ est gardé s'il a lu juste au moins 3 fois, sans aucune erreur. Sinon il est retiré, de même qu'un champ impossible à vérifier (sauf le message du prospect).
  - Le gabarit est retiré s'il ne reconnaît aucun mail, s'il reconnaît les mails d'un autre portail ou des mails qui ne sont pas des leads, ou s'il ne lui reste pas de quoi joindre le prospect avec son nom ou le bien.
  - Les mails que ni les règles ni les gabarits ne savent lire sont lus par l'IA, qui en apprend de nouveaux gabarits.
  - Simulation par défaut. En écriture, les gabarits vérifiés lisent seuls, les gabarits retirés passent en quarantaine (rien n'est effacé) et les gabarits appris sont ajoutés.
  - Le rapport, sans donnée personnelle, arrive dans Fichiers.

## 2.13.7

- Une table Postgres qui porte le nom d'une table à créer, mais que Saltcorn ne connaît pas (reste d'un essai, d'un ancien plugin ou d'un script), bloquait toute l'installation avec « relation "ld_mails" already exists ».
  - Elle est maintenant renommée « <nom>_ancienne_<date> ». Rien n'est effacé : ses données restent.
  - Le bloc « Leads : préparer les tables » dit quelles tables ont été mises de côté.

## 2.13.6

- Serveur à plusieurs processus : une table ou un workflow créé par dysizz-flow est vu partout, sans redémarrage.
  - Avant, seul le processus qui l'avait créé le voyait. Les autres disaient « table absente », ou « relation … already exists » quand on relançait la création.
  - Le modèle du Catalogue, le bloc « Leads : préparer les tables », l'éditeur et les écouteurs préviennent maintenant tous les processus, une fois la requête terminée.
  - Une table déjà créée par un autre processus est retrouvée en base au lieu d'être recréée.

## 2.13.5

Corrections venues du contrôle du CRM sur 50 vrais leads (lecture seule).
- Consentement : un consentement déjà posé sur la fiche n'est plus remplacé.
  - La recherche de contacts d'Immofacile ne renvoie pas le consentement. Le moteur relit donc la fiche trouvée avant de décider.
  - Si la fiche ne peut pas être relue, aucun consentement n'est posé et le lead passe « à vérifier ».
- Motif du consentement : 64 caractères au plus (limite d'Immofacile). Le nom du portail est raccourci, la date est toujours gardée.
- Idealista : l'e-mail du prospect est lu même quand sa ligne contient aussi un lien vers Idealista.
- Contrôle du CRM, plus précis :
  - « autre fiche » dit si c'est un doublon dans le CRM (même e-mail ou même téléphone) ou une vraie différence, et comment le moteur l'a trouvée ;
  - un e-mail ou un téléphone présent dans le mail mais non lu par le moteur est signalé à part ;
  - un consentement que le moteur remplacerait est signalé.

## 2.13.4

- Réponse de l'équipe (« Re : ») à un prospect que le système ne connaît pas : elle n'est plus perdue.
  - Si le mail cité contient un prospect (e-mail, relais du portail, téléphone ou message), c'est peut-être la seule trace d'un lead jamais reçu : le mail est transféré à « non automatisé », pour être vérifié.
  - Rien n'est écrit dans le CRM. Sans prospect cité (message interne), rien ne change : rien à faire.
  - Vu au banc d'essai : 58 mails de ce type sur 8 672.

## 2.13.3

- Banc d'essai et contrôle du CRM en arrière-plan : on voit où ils en sont, et ils ne peuvent plus tourner sans fin.
  - Un nouveau clic pendant le travail montre l'étape et l'avancement (ex. « rejeu du moteur : 3 200 / 8 627 »).
  - Délais maximaux : 90 s par lecture par l'IA, 1 min par lecture Immofacile, 2 min par lead contrôlé, 2 h en tout. Au-delà, « …-erreur.json » donne la dernière étape atteinte.
  - Un travail resté bloqué n'empêche plus d'en relancer un (verrou libéré après 2 h).
  - Le travail tourne dans un contexte propre (même tenant, connexions communes), plus dans celui de la requête du bouton.
- Contrôle du CRM : 50 leads par défaut.
- Rapprochement : une référence très courte (moins de 4 caractères, ex. « 12 ») n'est plus une preuve suffisante à elle seule. Le bien doit être confirmé par les faits du mail (ville, code postal, prix, surface).
- Giraffe : une référence accolée à des lettres dans le nom du projet (ex. « AGX12345 ») est lue.
- Zefir : quand le mail dit « Coordonnées de l'acheteur : » avec le nom sur la ligne suivante, c'est ce nom qui est lu. Avant, « l'acheteur » était pris pour le nom du prospect.
- Banc d'essai et contrôle du CRM : les domaines de l'agence sont repris des réglages Leads et des boîtes des agences (hors messageries publiques). Le champ ne sert plus qu'à en ajouter : laissé vide, il faisait prendre les réponses de l'équipe (« Re : ») pour des prospects.
- Tous les portails, l'IA et les gabarits : un rôle (acheteur, acquéreur, prospect, contact, client, internaute, vendeur, madame, monsieur…) n'est jamais retenu comme prénom ou nom, donc jamais écrit dans le CRM.

## 2.13.2

- Banc d'essai et contrôle du CRM : ils tournent en arrière-plan. Le bouton « Tester » répond tout de suite et le rapport arrive dans Fichiers à la fin. Avant, un travail de plusieurs minutes (IA, lectures Immofacile) faisait couper la requête par le proxy, avec l'erreur « Bad Gateway ».
  - Si le travail échoue, un fichier « …-erreur.json » dit pourquoi.
  - Un seul banc (ou contrôle) à la fois : un deuxième clic répond « déjà en cours ».
  - Réglage « En arrière-plan » : décoché, le bouton attend la fin.

## 2.13.1

- Nouveau bloc « Leads : contrôle du CRM (fiches ↔ mails) », en lecture seule. Pour des leads déjà écrits dans le CRM (par l'ancien système, ou par celui-ci une fois en service), il relit chaque fiche et la compare avec le mail d'origine et avec ce que le moteur ferait. Rien n'est écrit, et le rapport ne contient aucune donnée personnelle.
  - **Recherche** : le moteur cherche le contact et le bien dans le vrai CRM, en lecture seule. On voit s'il retrouve la même fiche que l'ancien, ou s'il en créerait une.
  - **Lecture** : e-mail, téléphone, prénom et nom de la fiche comparés au mail.
  - **Fiche** : origine, groupe « Demandeur », négociateur et agence du bien, bien suivi, consentement (présence, motif de 64 caractères au plus, date, preuve).
  - **Écriture** : chaque valeur que le moteur écrirait, contrôlée au bon format et comparée à la fiche réelle. Cela couvre e-mail, téléphone ou mobile, prénom, nom, origine, négociateur, agence, bien suivi et consentement.
- Immofacile : lecture des biens suivis d'un contact et du détail de son consentement, permise en lecture seule.
- Leads, gabarits : un gabarit ne lit seul un mail qui part sans vérification que s'il a été confirmé par l'IA au moins 3 fois, sans échec. Sinon le mail est à vérifier, comme un mail lu par l'IA ou par les règles générales.
- Leads, gabarits d'un ancien système : ils sont repris comme **candidats**, à confirmer par l'IA avant de servir. Sur les vrais mails d'AMBS, 84 gabarits « actifs » de l'ancien avaient presque tous 0 observation, et ceux qui ont servi au banc donnaient un mauvais e-mail 4 fois sur 11.
- Banc d'essai, diagnostic des écarts :
  - pour chaque écart, le motif et la règle de l'ancien système (anonymisés) ;
  - quand les deux systèmes ne trouvent pas le même bien, la ligne du mail (anonymisée) où l'ancien avait lu sa référence ou l'identifiant du bien ;
  - un bien entré dans le catalogue après le mail est signalé à part.
- Banc d'essai, présentation : les exemples montrent d'abord les écarts graves (autre bien, autre e-mail ou téléphone, autre identité, lead perdu), et le rapport indique les domaines de l'agence utilisés.
- Banc d'essai : l'IA lit 100 mails par défaut (0 pour la couper), y compris depuis un déclencheur réglé avant cette version.

## 2.13.0

Banc d'essai complet (règles, gabarits, IA) et références lues d'après les vrais mails.

- Banc d'essai : les gabarits de l'ancien système (table `gabarit_version`) ou ceux de la solution Leads (`ld_gabarits`) sont copiés en mémoire et utilisés pendant le rejeu. Le banc n'écrit plus rien, même dans les gabarits.
- Banc d'essai : option « IA : nombre de mails lus par l'IA ». L'IA réglée dans les réglages Leads lit un échantillon des mails que ni les règles ni les gabarits ne savent lire, réparti entre les portails. Ce qu'elle apprend sert ensuite aux autres mails de la même forme, comme en production.
- Banc d'essai : chaque étage de lecture est mesuré à part (règles, gabarit, IA), et un mail qui aurait eu besoin de l'IA sans l'avoir eue est compté « IA non appelée » au lieu de fausser la décision.
- French-Property : la référence retenue est celle du bien (« Détails du bien - Réf. », « votre bien N »), celle de la demande devient la référence du portail. L'identifiant du bien placé sous « Détails du bien » est lu et n'est plus pris pour le prix. La commune est lue après le département.
- Arkadia : l'identifiant Arkadia (« ABCD-T… ») et la référence de l'agence sont lus dans l'objet.
- Kyero : la référence est lue (« [F3FB…] »).
- Moulin.nl : titre, référence de l'objet (« (…) ») et identifiant du portail lus.
- Nouveau bloc « Leads : recevoir un mail rangé par un autre système » : recopie un mail déjà rangé par un ancien système dans la table des mails reçus, une seule fois, puis lance le traitement. La solution tourne ainsi en mode ombre à côté de l'ancien, sans deuxième connexion à la boîte.

## 2.12.2

Corrections tirées du banc d'essai sur les 8 612 vrais mails d'AMBS.

- Un mail qui n'est pas un lead (ni client ni bien : expéditeur inconnu, réponse à une campagne) n'est plus transféré au « non automatisé » ; seuls les leads à qui il manque quelque chose (bien, agence, négociateur, contact) et les mails directs d'un particulier y partent.
- Réponse d'absence reconnue à son texte (objet « Re : … »), avec deux signes obligatoires (l'absence et « pour toute demande… » / « je n'aurai pas accès… ») ; jamais pour un mail de portail.
- Démarchage : un acheteur qui demande une brochure ou cite le site internet n'est plus signalé (règle resserrée sur les vrais signes de démarchage).
- Zefir : « Un acheteur Zefir souhaite visiter… » est un lead acheteur (et non une estimation) ; coordonnées, bien, prix, ville et code postal lus.
- Banc d'essai : toute valeur après « Libellé : » est masquée (un nom qui revenait souvent pouvait passer) ; identité comparée prénom + nom ensemble ; e-mail relais compté ; forme des références (lettres → A, chiffres → 9) ; raison du rejet d'un bien ; bien de l'ancien absent du catalogue signalé à part.

## 2.12.1

- Leads, site d'agence (AC3) : une « création de compte » n'est un lead que si le mail porte le client (e-mail ou téléphone) et un bien.
- Banc d'essai : quelques exemples anonymisés de chaque portail, même sans écart (voir la forme des mails).
- Leads, site d'agence (AC3) : la source est l'agence nommée dans la demande (« Demande auprès de SELECTION HABITAT » → Selection Habitat), jamais « AC3 » ; dans le CRM, l'origine est celle du site de cette agence (réglage `sites`, sinon l'origine qui porte son nom).
- Nouveau bloc « Leads : banc d'essai sur les mails d'un ancien système » : rejoue le traitement sur les mails déjà reçus et compare, mail par mail, avec ce que l'ancien système avait trouvé (source, e-mail, téléphone, nom, prénom, référence, bien, agence, négociateur, décision). Lecture seule. Rapport sans donnée personnelle dans Fichiers : accords par portail et par champ, type de chaque écart, squelette anonymisé des mails en écart.
- Leads : alerte quand le motif du consentement dépasse 64 caractères (Immofacile coupe au-delà).

## 2.12.0

- Leads : un lead qui ne peut pas être automatisé (bien, agence, négociateur ou contact introuvable, expéditeur inconnu) est **transféré tel quel**, avec son objet d'origine, à l'adresse réglée dans `adresse_non_automatise` (ex. une boîte « non automatisé »). Plusieurs adresses possibles. Sans adresse : rien ne part, comme avant.
- Leads : format des mails envoyés au choix (`format_envoi`) : `resume` (fiche du lead, défaut) ou `origine` (le mail reçu tel quel, son objet d'origine, l'en-tête d'origine et la liste des destinataires).
- Leads : un mail d'un portail connu dont l'objet n'est pas reconnu, mais qui porte les coordonnées d'un prospect et un bien, est traité comme un lead (alerte notée) : un portail qui change ses objets ne fait plus perdre de leads en silence.
- Portails déclarés par le client (`ld_portails`) : une adresse exacte en plus des domaines (formulaire d'un site qui écrit depuis le domaine de l'agence) ; champ `origine` (code d'une origine du CRM). Réglage `origine_defaut` : origine utilisée quand le portail n'en a pas.

## 2.11.1

- Leads : l'équipe et les règles d'envoi peuvent être lues dans les tables d'une application (ex. écrans Gestion : `equipe`, `absence`, `regle_envoi`, `destinataire_custom`), avec l'identifiant du CRM de chaque personne (réglage `routage_tables` de `ld_reglages`, ex. `{"equipe":"equipe","absence":"absence","regle":"regle_envoi","copies":"destinataire_custom","id":"user_id"}`). Une seule source pour l'équipe.
- Routage « tables » : option `id` (colonne de l'équipe qui porte l'identifiant utilisé sur les biens). Testé.
- Bloc « Leads : reprendre les gabarits d'un ancien système » : les gabarits de lecture appris (ex. table `gabarit_version`) sont repris ; plus besoin de l'IA pour ces formes de mails.

## 2.11.0

Tout le backend des leads immobiliers est maintenant dans dysizz-flow, avec des blocs réutilisables : le plugin dysizz-leads n'est plus nécessaire (le désinstaller).

- **Catalogue** : deux modèles.
  - « Leads immobiliers : traiter chaque mail reçu » : lecture, bien, agence et contact, consentement anti-démarchage, qui reçoit, CRM (ombre ou réel), enregistrement, puis **envoi du lead aux destinataires**. Crée les tables à l'installation.
  - « Leads immobiliers : chaque heure » : catalogue des biens, reprises des mails restés sans lead, envois en échec réessayés, conservation.
- **Blocs Leads** (catégorie « Leads immobiliers ») : préparer les tables, préparer le mail reçu, lire, retrouver le bien, contact, consentement, qui reçoit, écrire dans le CRM, enregistrer, préparer les mails du lead, traiter en un bloc, synchroniser le catalogue, reprises et entretien. Les tables portent un **préfixe réglable** (`ld_` par défaut) : plusieurs jeux de tables possibles.
- Tables complétées d'après les tables de l'ancien système : groupes, valeurs lues et leur provenance, messages des demandes, copies ciblées (agence, groupe, personnes), règles par agence ou par groupe, remplaçant en cas de départ, nouvelles colonnes des biens et de l'équipe.
- **Nouveaux blocs génériques** :
  - « Table : créer ou compléter » : crée une table ou ajoute les champs qui manquent (liens, listes de choix, droits, index), sans jamais rien supprimer ;
  - « Mail : envoyer une seule fois (avec reprise) » : une clé par envoi, jamais deux fois, échec noté ; « Mail : reprendre les envois en échec », abandon après 5 essais ou une erreur définitive ; mode « simuler ».
- Modèles du Catalogue : canal du déclencheur (écouteur de boîte mail) et blocs lancés une fois à l'installation.
- Plus aucune minuterie cachée : les tâches horaires sont un workflow visible.

## 2.10.0

- Leads, routage « tables » : **copies ciblées**. Une adresse de `destinataire_custom` peut recevoir en copie :
  - tous les leads (`portee` = « tous », comme avant) ;
  - ou seulement ceux d'une agence (`agence`), d'un groupe (`groupe`, membres au moment de l'envoi) ou de personnes choisies (`personnes` = "3,7,9").
- Moteur : `conf.copies` = `[{ email, nom, cible }]` à côté de `conf.siege`.
- Éditeur de workflows : les workflows faits à la main (comme `automatisation`) s'affichent enfin reliés.
  - « Étape suivante » écrite en JavaScript : noms d'étapes avec ou sans guillemets, conditions imbriquées (`a ? x : (b ? y : z)`). Chaque lien porte sa condition en clair (« si gabarit », « sinon »), en vert ou en rouge.
  - Rangement en couches : chaque étape sous celles qui y mènent, moins de croisements, retours en arrière ignorés.
  - Un grand workflow s'ouvre en haut, à une taille lisible ; « Tout voir » montre l'ensemble.
- Moteur leads **en étapes** (`etapeLire`, `etapeBien`, `etapeContact`, `etapeConsentement`, `etapeDestinataires`) : chacune peut être un bloc de workflow (dysizz-leads 1.4). `traiter` les enchaîne ; résultat identique, vérifié mail par mail, y compris quand le dossier passe par le contexte JSON d'un workflow (`tests/etapes.test.cjs`).
- Bloc « Verrou » : peut attendre que le verrou se libère (réglage « attendre jusqu'à », en secondes), puis s'arrêter en erreur si le temps est dépassé.
- Immofacile : le jeton est gardé d'un adaptateur à l'autre (clé = empreinte de l'adresse, du site et des identifiants) : un workflow en étapes ne redemande pas un jeton à chaque étape.

## 2.9.0

- Éditeur de workflows :
  - Le déclencheur montre qui lance réellement le workflow (« Lancé à chaque ajout dans action_lot »). Ce sont les déclencheurs de table (bloc « Lancer un autre workflow ») et les étapes d'autres workflows. Avant, il affichait « À la main ».
  - La liste des lanceurs, avec un lien vers chacun, est dans le panneau du déclencheur. La liste des workflows les résume (« lancé par 34 déclencheurs sur lead, lead_bien… »).
  - La condition « seulement si » est écrite en clair dans chaque étape, et plus seulement sous forme d'icône.
  - Police du kit partout : certains textes passaient en police serif du navigateur.
  - Astuces : le bouton `{ }` ne passe plus à la ligne.
- Aide du filtre des blocs de table : « modifier » et « supprimer » refusent un filtre vide.

## 2.8.0

- **Lancer un autre workflow** :
  - un contexte vide (`{}`) transmet bien tout le contexte actuel, comme l'annonce l'aide (avant : le workflow recevait un contexte vide) ;
  - lancé par un déclencheur de table, le workflow voit chaque colonne de la ligne, `null` si elle est vide : une condition « only if » sur un champ laissé vide ne bloque plus le workflow en « Running » ;
  - option `cumuler` : pendant un regroupement, les valeurs d'une rafale sont réunies en liste (ex. les leads touchés) ; `"*"` ou plus de 2000 valeurs donnent `null` (= tout recalculer).
- **Table : lire (SQL)** : `$1` dans la requête reçoit la liste des clés à recalculer (null = tout) ; les commentaires `--` et `/* */` sont acceptés ; une liste de clés vide ne lit rien.
- **Table : modifier** : option `ignorer_vides` pour les modifications en lot (seuls les champs remplis s'appliquent, seuls les critères posés filtrent ; un filtre vide est refusé).
- Blocs d'écriture de table (ajouter, modifier, tenir à jour) : une écriture refusée par Saltcorn (droits, champ protégé) devient une erreur ; avant, le bloc annonçait un succès.
- Moteur : un réglage JSON enregistré comme objet voit ses `{{ }}` remplacés à chaque niveau.
- **Leads : règles d'envoi lues dans les tables** : règle pour un **groupe** ou une **agence** (les personnes de l'équipe qui en font partie), une règle personnelle passe avant ; un groupe vide ne vise personne (et non plus tout le monde) ; relais d'absence par **adresse libre** (`remplacant_adresse`) ; assistant(e) avec les valeurs lisibles « reçoit », « ne reçoit pas », « remplacé(e) ».

## 2.7.0

- Nouveau bloc **Table : tenir à jour une table de lecture** : une requête SELECT (jointures, dernières valeurs, regroupements) recalcule une table ; seules les lignes qui ont changé sont écrites, les lignes disparues sont retirées, et l'on peut ne recalculer que quelques clés. La requête tourne en lecture seule ; l'écriture est faite par le bloc, en paramètres, dans la seule table choisie. Les pages lisent ensuite cette table au lieu de tout recalculer dans le navigateur.
- **Lancer un autre workflow** : option « regrouper » ; vingt événements en rafale (un mail qui écrit vingt lignes) ne lancent le workflow qu'une fois, jamais deux en parallèle.
- Sécurité multi-tenant : les requêtes SQL écrites dans les blocs (lecture et table de lecture) ne lisent que les tables du tenant hors du tenant racine (règles dans `src/garde.js`).
- **Leads : règles d'envoi lues dans les tables** de l'équipe (`"tables"` au lieu d'un JSON) : personnes, assistant(e)s, temps partiel et jours travaillés, absences (congés, longue durée, départ sans date de fin) avec leur relais, règles pour une personne ou un **groupe**, destinataires en copie.
- Nouveau bloc **Leads : tenir à jour « qui reçoit aujourd'hui »** : pour chaque négociateur, les adresses qui recevraient un lead aujourd'hui et pourquoi. Lancé à chaque changement de l'équipe et toutes les heures, la fin d'un congé se voit seule.
- Nouveau bloc **Table : contrôler une écriture** (événement Validate) : refuse une écriture selon une condition (ex. écrire sur le ticket d'un autre) et recopie des valeurs d'une ligne liée ; vérifié par le serveur pour les formulaires comme pour l'API.
- Correction : les exemples de « Leads : qui reçoit ? » lisaient `destinataires` ; le résultat est `liste`.
- Tests : `tests/lecture.test.cjs` contre un vrai PostgreSQL, ajouté à la CI.

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
