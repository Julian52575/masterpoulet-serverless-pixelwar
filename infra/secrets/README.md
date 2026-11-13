# Secret Manager — conteneurs uniquement

Référence : [C07 functions/INFRASTRUCTURE.md](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/blob/16c21c3/functions/INFRASTRUCTURE.md),
consultée sans fusion de C07. Les IDs identiques sont isolés par projet DEV/PROD.

| Secret | Lecteur attendu, à configurer quand il existe |
| --- | --- |
| discord-public-key | Fonction discord-proxy : validation de signature Ed25519 |
| discord-oauth-client-secret | Fonction web-auth : échange OAuth |
| discord-snapshot-webhook | Fonction snapshot-notifier : publication des snapshots |
| discord-bot-token | Opérateur humain lançant register-commands.js, aucun runtime |

Ce root déclare l’API Secret Manager et quatre conteneurs protégés, sans version
ni valeur secrète. Aucun compte applicatif n’est créé. secret_accessors et
secret_version_adders sont vides par défaut ; les grants sont des iam_member
au niveau du secret. Les runtimes doivent appartenir au projet sélectionné.
secretAccessor permet la lecture de versions ; secretVersionAdder permet seulement
l’ajout. Aucun de ces droits n’est accordé au déployeur au niveau projet.

## Inventaire obligatoire avant création

L’API est désactivée dans les deux projets. L’inventaire est donc inconnu,
pas vide. inventory_confirmed=false bloque les conteneurs dans les tfvars livrés.
Après approbation seulement : activer l’API, inventorier les métadonnées,
rechercher tout propriétaire Terraform et remplir existing_secret_ids. Un
premier plan ciblé sur google_project_service.secretmanager peut préparer la
seule activation de l’API ; aucune application de ce plan n’est autorisée ici.
Si l’API a été adoptée ailleurs, réconcilier son ownership avant cette étape.

Pour chaque secret existant, vérifier aussi la réplication : le code prévoit
auto, qui doit être adapté à une configuration existante différente avant
adoption. Ne jamais accepter un remplacement pour la normaliser. imports.tf
prépare les imports déclarés ; aucun import effectif n’est lancé. Préparer
également l’adoption de tout grant IAM déjà présent avant une future application.

Les futurs comptes C05–C07 seront renseignés explicitement dans secret_accessors,
uniquement lorsqu’ils existeront. Exemple de clé : discord-public-key ; valeur :
["serviceAccount:discord-proxy@masterpoulet-dev.iam.gserviceaccount.com"].
Ne pas ajouter les autres fonctions comme lecteurs et ne pas donner le bot token
à un runtime. Les accès GKE/ARC restent indépendants de ces secrets applicatifs.

## Valeurs, rotation et ARC — procédures futures

Après création approuvée des conteneurs et grants, un opérateur autorisé ajoute
une version via la console ou gcloud secrets versions add avec --data-file pointant
sur un fichier privé hors dépôt (ou stdin), jamais une valeur dans la commande,
les tfvars ou l’historique du shell. Ne pas activer de trace shell, exporter le
state ou publier les logs. Le rôle versionAdder seul ne permet pas de lire une
ancienne version, ni de la désactiver.

Pour renouveler : ajouter la nouvelle version hors Terraform, valider son usage
par la fonction lors de la future livraison, puis faire désactiver l’ancienne
par un opérateur disposant de ce droit. Ne pas désactiver l’ancienne avant cette
validation ; conserver une possibilité de retour. Aucune injection/rotation ici.

ARC DEV possède encore le Secret Kubernetes github-pat-arc, type Opaque ; seule
sa métadonnée a été lue. Le state runners/dev est actuellement vide au serial 5.
La source de restauration hors cluster n’est pas confirmée. Après destruction
de GKE, recréer manuellement arc-runners et ce Secret depuis une source autorisée,
sans extraire sa valeur du cluster pendant cette mission, puis appliquer runners
après revue. Ne pas migrer ce credential automatiquement vers Secret Manager.

Backend : secrets/dev ou secrets/prod, bucket et tfvars du même environnement.
Voir [C03](../C03.md) : aucune ressource déployée et aucun plan cloud certifié.
