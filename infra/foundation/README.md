# Foundation — réseau GCP partagé

[Guide principal](../README.md) · [Cluster GKE](../gke/README.md)

Cette stack prépare le réseau utilisé par GKE. Elle gère **quatre ressources**
par environnement, pas de VM ni de cluster. Le même code utilise dev.tfvars ou
prod.tfvars ; le provider cible explicitement var.project_id.

## Ressources et responsabilités

| Adresse Terraform | Fichier | Rôle |
| --- | --- | --- |
| google_compute_network.vpc | main.tf | VPC global en mode custom, sans subnets automatiques, routage dynamique REGIONAL. |
| google_compute_subnetwork.subnet | main.tf | Subnet régional avec plage primaire, plages secondaires et Private Google Access. |
| google_compute_router.router | router.tf | Cloud Router régional attaché au VPC. |
| google_compute_router_nat.nat | nat.tf | Public NAT configuré sur ce Router, pour le seul subnet sélectionné. |

Le réseau GCP default, ses subnets et ses règles ne sont pas pris en charge par
cette stack. Les projets, buckets, IAM, activations API, pare-feu, clusters et
load balancers ne sont pas créés ici. GKE peut créer ses propres ressources
techniques lors de son déploiement ; elles n'apparaissent pas comme ressources
autonomes dans le code foundation.

### VPC, subnet et plages IP

Le **VPC** est le réseau logique global. Le **subnet** réserve des adresses dans
une région. La zone GKE europe-west1-b est dans europe-west1 : son cluster peut
utiliser le subnet DEV régional sans créer un subnet par zone.

La plage **primaire** sert notamment aux adresses des nœuds. Les secondaires
nommées servent aux Pods et aux IP virtuelles de Services Kubernetes. Un Service
ClusterIP n'est pas une IP publique ni un load balancer GCP.

| Paramètre / variable | DEV | PROD |
| --- | --- | --- |
| project_id | masterpoulet-dev | masterpoulet-prod |
| region | europe-west1 | europe-west3 |
| network_name | masterpoulet-dev-vpc | masterpoulet-prod-vpc |
| subnet_name | masterpoulet-dev-vpc-subnet | masterpoulet-prod-vpc-subnet |
| subnet_cidr | 10.0.1.0/24 | 10.0.2.0/24 |
| gke_pods_cidr | 10.16.0.0/21 | 10.32.0.0/21 |
| gke_services_cidr | 10.16.8.0/24 | 10.32.8.0/24 |
| Nom secondaire Pods, dérivé du subnet | masterpoulet-dev-vpc-subnet-pods | masterpoulet-prod-vpc-subnet-pods |
| Nom secondaire Services, dérivé du subnet | masterpoulet-dev-vpc-subnet-services | masterpoulet-prod-vpc-subnet-services |
| Router, dérivé du VPC | masterpoulet-dev-vpc-router | masterpoulet-prod-vpc-router |
| NAT, dérivé du VPC | masterpoulet-dev-vpc-nat | masterpoulet-prod-vpc-nat |

Les sept premières lignes sont les variables d'entrée de variables.tf. region
a europe-west1 pour défaut ; les tfvars précisent la région de chaque cible.
Les CIDR ont une validation de forme IPv4 canonique ; elle **ne prouve pas**
l'absence de chevauchement avec tout le réseau de l'organisation.

Un /21 contient 2 048 adresses et un /24 256 adresses. Le nombre de nœuds possibles
dépend de max_pods_per_node : avec le réglage GKE actuel de 32, un bloc /26 est
alloué par nœud, soit une capacité IP théorique de 32 nœuds dans le /21. Le pool
reste toutefois limité à **deux nœuds** ; la mémoire/CPU limite aussi les Pods.
L'ancienne estimation de huit nœuds utilisait la valeur GKE par défaut de 110
Pods et un /24 par nœud ; elle ne décrivait pas la capacité de nos VM.

Les plages des deux environnements sont distinctes, ce qui facilite une future
interconnexion. Aucun peering/VPN n'est configuré par cette stack. L'inventaire
historique des 86 plages DEV/PROD n'avait trouvé aucun chevauchement entre les
plages choisies ; les réseaux externes n'étaient pas couverts. Refaire le contrôle
avant peering, VPN, nouvelle plage ou extension.

### Routes, Cloud Router et Cloud NAT

| Concept | Explication concrète |
| --- | --- |
| Route VPC | Indique une destination et le prochain saut. Les routes du subnet et la route de sortie Internet avaient été observées automatiquement ; aucune google_compute_route n'est déclarée. |
| Cloud Router | Porte la configuration NAT et peut échanger des routes dynamiques avec BGP ; aucun lien BGP/VPN n'est défini ici. Ce n'est pas une VM de routage. |
| Cloud NAT | Traduit les IP privées des connexions sortantes vers des IP publiques partagées, puis permet les réponses. Il n'expose pas un serveur aux connexions entrantes spontanées. |

Les nœuds privés utilisent la route de sortie VPC et le NAT pour télécharger
des dépendances ou contacter GitHub sans IP publique individuelle. Le NAT ne
remplace ni les routes ni les règles de pare-feu autorisant la sortie. Il ne
fournit pas l'accès kubectl au control plane : celui-ci utilise l'endpoint DNS.

nat.tf sélectionne **AUTO_ONLY** pour laisser Google allouer les IP de sortie,
et **LIST_OF_SUBNETWORKS** avec une référence à google_compute_subnetwork.subnet.id.
Le bloc source_ip_ranges_to_nat=["ALL_IP_RANGES"] couvre la plage primaire et
toutes les secondaires de ce subnet, y compris celles ajoutées ensuite. Aucun
changement NAT n'est nécessaire pour les plages GKE prévues. La région et le
projet sont des variables, le Router est une référence Terraform.

**Private Google Access**, activé sur le subnet, permet aux VM sans IP publique
d'accéder aux API Google prises en charge. Ce n'est pas une sortie Internet
générale ; Cloud NAT répond à ce second besoin.

## Backend et outputs

| Cible | Couple de fichiers | Bucket / préfixe |
| --- | --- | --- |
| DEV | backends/dev.hcl + dev.tfvars | masterpoulet_bucket / foundation/dev |
| PROD | backends/prod.hcl + prod.tfvars | masterpoulet_prod_bucket / foundation/prd |

Le backend générique est dans backend.tf. Les objets sont
foundation/dev/default.tfstate et foundation/prd/default.tfstate dans leurs
buckets respectifs, avec workspace default. Les buckets, conservés indépendamment
du réseau, ne doivent pas être supprimés lors du nettoyage d'une démonstration.
Voir [la sélection commune des backends](../README.md#sélectionner-la-stack-et-le-backend).

| Output | Information |
| --- | --- |
| network_id | Identifiant pleinement qualifié du VPC. |
| subnet_id | Identifiant pleinement qualifié du subnet. |
| subnet_cidr | CIDR primaire effectif du subnet. |

GKE utilise des data sources par nom, pas terraform_remote_state. Il n'existe
pas d'output de nom de plage secondaire dans foundation ; ces noms sont dérivés
du subnet et renseignés explicitement dans les tfvars GKE.

## Vérification et exploitation

Après les [installations et connexions du guide commun](../README.md#préparer-windows-et-les-identités),
exécuter depuis la racine du dépôt, pour DEV :

```powershell
Set-Location infra/foundation
terraform init -reconfigure -backend-config="backends/dev.hcl" -input=false
if ($LASTEXITCODE -ne 0) { throw 'Échec backend foundation DEV.' }
$foundationWorkspace = terraform workspace show
if ($LASTEXITCODE -ne 0 -or $foundationWorkspace -ne 'default') { throw 'Workspace default requis.' }
terraform fmt -check -recursive
if ($LASTEXITCODE -ne 0) { throw 'Format incorrect.' }
terraform validate
if ($LASTEXITCODE -ne 0) { throw 'Configuration invalide.' }
terraform plan -var-file="dev.tfvars" -input=false -lock-timeout=60s -out="dev.tfplan"
if ($LASTEXITCODE -ne 0) { throw 'Échec du plan.' }
terraform show dev.tfplan
terraform state list
terraform output
```

Pour PROD, reprendre la même procédure avec **backends/prod.hcl et prod.tfvars** ;
ne pas lancer un plan PROD avec le backend DEV. Les étapes d'application avec
confirmation sont [dans le guide principal](../README.md#planifier-et-déployer).
Un apply peut supprimer/remplacer selon le plan : ne jamais le déduire du seul nom
« foundation ». Examiner les dépendances GKE et les autres utilisateurs du VPC.

### Le script existant check.ps1

check.ps1 est un assistant **DEV uniquement**. Il contrôle le format, vérifie le
bucket, initialise, valide et prépare dev.tfplan. Il ne lance pas d'apply.
`./check.ps1 -LocalOnly` initialise les providers avec -backend=false et valide,
sans sélectionner un backend distant ni faire de plan. Cela peut nécessiter le
registre des providers et ne garantit pas un plan GCP réussi.

Le script distant n'utilise pas -reconfigure et appelle gcloud plutôt que
explicitement gcloud.cmd. En cas de changement de backend ou de politique
PowerShell restrictive, utiliser les commandes explicites ci-dessus. Ne pas
modifier le script ni désactiver une politique du PC pour suivre ce guide.

### Inspection Python et CI après intégration de Julian

L'inspecteur `scripts/check.py`, ses règles d'exclusion et ses tests sont
conservés. Il compare la configuration à GCP sans lire le state ni lancer
Terraform. Voir [son guide](scripts/README.md). Utiliser explicitement DEV :

```powershell
python scripts/check.py --env dev
python -m unittest discover -s scripts
```

Sans `--env dev`, l'inspecteur consulte aussi PROD. Ses champs non vérifiés,
dont les blocs des plages secondaires, ne remplacent jamais un plan Terraform.
L'ancien `check.ps1` reste disponible en complément.

La CI conserve les deux contrôles : `terraform-validate` valide toutes les
stacks sans credentials, et `terraform` réalise les plans foundation de Julian.
Deploy applique DEV puis PROD sur les tags de version correspondants ; Destroy
est manuel. Aucun de ces deux workflows ne se déclenche sur un push de branche
ou une PR. Ne pas pousser de tag pour cette intégration. Une suppression du
réseau demande une revue séparée des consommateurs GKE avant tout déclenchement.

### Contrôler dans GCP

Dans la console, sélectionner d'abord le bon projet :

1. **VPC network → VPC networks** : nom du VPC, mode custom, subnet et région.
2. Ouvrir le subnet : CIDR primaire, noms/CIDR secondaires, Private Google Access.
3. **VPC network → Routes** : route du subnet et sortie par default Internet gateway ; aucune route manuelle supplémentaire n'est nécessaire pour ce montage.
4. **Network Connectivity → Cloud Routers**, ou rechercher Cloud Router : région et VPC attendus.
5. **Network services → Cloud NAT**, ou rechercher Cloud NAT : Router, AUTO_ONLY et plages du subnet sélectionné.
6. **Cloud Storage → Buckets** : bucket et préfixe du state, sans éditer ni télécharger les states pour les partager.

Contrôles DEV en lecture seule :

```powershell
gcloud.cmd compute networks describe masterpoulet-dev-vpc --project=masterpoulet-dev
gcloud.cmd compute networks subnets describe masterpoulet-dev-vpc-subnet --region=europe-west1 --project=masterpoulet-dev
gcloud.cmd compute routers describe masterpoulet-dev-vpc-router --region=europe-west1 --project=masterpoulet-dev
gcloud.cmd compute routers nats describe masterpoulet-dev-vpc-nat --router=masterpoulet-dev-vpc-router --region=europe-west1 --project=masterpoulet-dev
gcloud.cmd compute routes list --project=masterpoulet-dev --filter='network:masterpoulet-dev-vpc'
```

## État vérifié et historique

Au **23 octobre 2026**, les quatre ressources sont présentes dans chacun des
states foundation. Les inventaires ont confirmé les subnets et les Router/NAT
DEV et PROD. Les secondaires sont présentes en DEV mais **absentes du subnet
PROD**, bien qu'elles figurent dans prd.tfvars : une future application du plan
foundation PROD sera nécessaire avant la stack GKE PROD. Aucun plan PROD récent
n'a été exécuté pour cette documentation.

Les noms et plages primaires sont conservés. Ajouter des plages secondaires
inutilisées est normalement une modification **en place** du subnet, pas une
recréation. Le plan DEV historique lors de leur préparation indiquait
0 ajout, 1 modification, 0 suppression. Ne pas réutiliser ce résumé comme résultat
actuel : elles sont maintenant appliquées en DEV. Une suppression/modification
de plage déjà utilisée par GKE est une autre opération, potentiellement bloquée
ou perturbatrice.

Autres résultats historiques utiles : avant Router/NAT et secondaires, DEV avait
un plan sans changement ; la préparation initiale PROD montrait deux créations
VPC/subnet. Le bucket PROD était alors vide. Ces constats ont évolué et ne
signifient pas qu'il faille recréer les ressources aujourd'hui.
[AUDIT.md](AUDIT.md) conserve les audits des 22–23 octobre, les erreurs de
facturation/API/backend et leurs résolutions successives. Ses noms de buckets
proposés et blocages anciens ne remplacent pas les backends actuellement versionnés.

## Suppression et coûts

**Supprimer GKE et vérifier tous les autres consommateurs avant foundation.**
Un destroy foundation vise les quatre ressources réseau de son state, y compris
NAT : les machines privées restantes perdraient leur accès sortant. GCP peut
refuser la suppression de subnets/VPC encore utilisés ; ce refus est un signal
à traiter, pas une raison de forcer la suppression. Les buckets sont hors de
cette stack et doivent être conservés.

Prévisualisation DEV, depuis ce dossier, après init DEV et revue des dépendances :

```powershell
terraform plan -destroy -var-file="dev.tfvars" -input=false -lock-timeout=60s -out="dev-destroy.tfplan"
if ($LASTEXITCODE -ne 0) { throw 'Échec plan de suppression foundation.' }
terraform show dev-destroy.tfplan
```

Ce bloc ne supprime rien. La [procédure commune](../README.md#détruire-et-recréer)
décrit la confirmation opérateur avant toute application de nettoyage. Pour
recréer, suivre init/plan/apply ordinaires puis recréer GKE, sans nouveau state.

Les plages privées n'ajoutent pas de VM ou de disque. Public NAT, ses IPv4, le
trafic et le stockage des states peuvent en revanche coûter. Après suppression
de GKE seule, foundation reste : contrôler l'usage NAT et les IP restantes.
Voir [les coûts communs](../README.md#coûts-et-économies).

Références : [plages alias IP](https://docs.cloud.google.com/vpc/docs/configure-alias-ip-ranges),
[dimensionnement Pods](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/flexible-pod-cidr),
[backend GCS](https://developer.hashicorp.com/terraform/language/backend/gcs).

## Historique C02 conservé lors de la fusion avec C04

La documentation C02 décrivait initialement la stack VPC/subnet avant les ajouts
Router, NAT et plages GKE. Elle confirmait les buckets existants en europe-west1,
avec versioning, accès uniforme et prévention d'accès public. Le bucket PROD
était vide avant son premier plan ; le plan initial proposait deux créations,
sans modification ni suppression. Le contrôle DEV d'alors ne changeait rien,
avec génération et empreinte MD5 du state identiques avant et après.
Ces observations sont historiques : consulter l'état daté plus haut et produire
un plan récent avant toute intervention.

La sélection locale du backend était alors PROD à la fin des vérifications ;
elle dépend aujourd'hui du dernier init effectué sur chaque PC. Toujours
réinitialiser explicitement le bon backend et le workspace default. Les valeurs
publiques des tfvars, le backend générique et la séparation des buckets sont
conservés ; aucun credential n'est ajouté aux fichiers partagés.

La révision C02 fusionnée a2b4732 utilise toujours prd.tfvars et backends/prd.hcl.
Ce constat est historique. L'intégration de `feat/serverless-deployment`
adopte désormais `prod.tfvars` et `backends/prod.hcl` dans toutes les stacks,
sans changer les préfixes `foundation/dev` et `foundation/prd`. Les plages
secondaires GKE des deux environnements sont conservées. Les noms des projets,
ressources et objets state restent inchangés ; aucune migration n'est nécessaire.

Contrôle DEV au moment de cette fusion : le backend foundation/dev contient
le VPC et le subnet ; l'inventaire GCP des Cloud Router est vide. Le plan prévoit
donc deux créations (Router et NAT), zéro modification et zéro suppression.
Ces deux définitions sont identiques dans les branches C02 et C04 : ce résultat
ne vient pas de la résolution des conflits. Le VPC, la plage primaire et les
secondaires existantes restent inchangés. Aucune création, application ou import
n'est effectué pendant la fusion. Ce contrôle plus récent remplace les anciens
constats de présence Router/NAT en DEV pour l'état observé lors du merge.
