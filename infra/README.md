# Infrastructure GCP — guide de l’équipe

Quatre roots Terraform indépendants, sans wrapper :

| Root | Responsabilité | Préfixes GCS |
| --- | --- | --- |
| bootstrap | Buckets de state existants, protégés contre la suppression | bootstrap/dev, bootstrap/prod |
| foundation | VPC, subnet, plages GKE, Router et NAT optionnel | foundation/dev, foundation/prod |
| gke | Cluster privé, pool runners, compte de service et IAM des nœuds | gke/dev, gke/prod |
| runners | Helm : contrôleur ARC et runner scale set | runners/dev, runners/prod |

| Paramètre | DEV | PROD |
| --- | --- | --- |
| Projet | masterpoulet-dev | masterpoulet-prod |
| Région du réseau | europe-west1 | europe-west3 |
| Zone GKE | europe-west1-b | europe-west3-b |
| Bucket de state | masterpoulet_bucket | masterpoulet_prod_bucket |
| VPC | masterpoulet-dev-vpc | masterpoulet-prod-vpc |
| Subnet primaire | 10.0.1.0/24 | 10.0.2.0/24 |
| Pods / Services | 10.16.0.0/21 / 10.16.8.0/24 | 10.32.0.0/21 / 10.32.8.0/24 |

Les deux buckets sont en europe-west1. Le workspace est default. Toujours
associer backends/dev.hcl à dev.tfvars, ou backends/prod.hcl à prod.tfvars.
Configurer un TF_DATA_DIR local distinct pour chaque couple root/environnement.
Un changement d’environnement n’est jamais une migration de backend.

## Vérifier sans accéder à GCP

Depuis chaque root, avec un TF_DATA_DIR neuf et les providers disponibles :

```sh
terraform fmt -check -recursive
terraform init -backend=false -input=false -lockfile=readonly
terraform validate
```

La CI exécute ces contrôles sur les quatre roots, sans credential cloud. Cela
ne valide ni le drift réel, ni les quotas, ni les droits, ni la facturation.
Le workflow Terraform Plan reste manuel, utilise OIDC/WIF et ne fait aucun apply.
Ses variables d’environnement GitHub WIF_PROVIDER et DEPLOYER_SA doivent exister.
Les pools/providers WIF et les droits du déployeur ne sont pas gérés par ces roots.

## Exploitation future, hors mission de nettoyage

Prérequis : Terraform, gcloud/ADC autorisés, APIs GCP, facturation et quotas.
Pour ARC : kubectl, gke-gcloud-auth-plugin et accès au chart public GHCR.
Avant une écriture PROD, résoudre la [bascule des opérateurs](foundation/MIGRATION-PROD-2026-11-11.md).
Coordonner les écrivains, vérifier le backend et lire le plan complet.

Exemple DEV, depuis le root choisi et son TF_DATA_DIR dédié :

```sh
terraform init -backend-config=backends/dev.hcl -input=false -lockfile=readonly
terraform workspace show
terraform state list
terraform plan -var-file=dev.tfvars -input=false -lock-timeout=60s -out=dev.tfplan
```

Après revue uniquement, terraform apply dev.tfplan applique le plan enregistré.
Pour PROD, utiliser les deux fichiers prod correspondants, jamais les CIDR DEV.
L’ordre est foundation → GKE → runners. Bootstrap possède déjà les buckets :
ne pas relancer leurs imports ni les recréer. Les réseaux default sont hors state.

Pour réduire les coûts : retirer les releases runners avant GKE. Un cluster
protégé exige d’appliquer deletion_protection=false avant un nouveau plan destroy.
Ne jamais détruire foundation/bootstrap pour éteindre les VM. Après GKE seulement,
un plan foundation avec -var=enable_nat=false peut supprimer le NAT en conservant
VPC, subnet, plages secondaires et Router. Vérifier qu’aucun autre usage ne dépend du NAT.
Conserver le bloc moved du NAT, même si l’ancien state n’a pas encore enregistré nat[0].

## Secrets, réseau et coûts

GKE sert uniquement aux runners CI/CD. L’application cible reste serverless.
Les nœuds sont privés ; l’endpoint DNS du control plane est accessible à distance
sous contrôle IAM. Ne pas confondre nœuds privés et absence d’accès au control plane.
Workload Identity GKE et le rôle container.defaultNodeServiceAccount sont conservés ;
le scope OAuth cloud-platform n’ajoute pas de rôle IAM aux workloads.

Le provider Helm impose le contexte du projet/zone/cluster sélectionné.
Rafraîchir son kubeconfig avec gcloud container clusters get-credentials, en donnant
explicitement projet, zone, cluster et --dns-endpoint avant d’utiliser Helm.
Le namespace arc-runners et le Secret github-pat-arc (clé github_token) doivent
préexister ; ils ne sont pas créés ni lus par Terraform. Leur restauration après
destruction du cluster est manuelle et doit être préparée hors Git. Ne pas placer
de token dans les tfvars, les valeurs Helm, les plans publiés ou les commits.

Un minimum d’un nœud reste facturable, même sans job. Le pool est limité à 1–2
nœuds et le scale set à 0–2 runners ; ce ne sont pas des plafonds de dépense GCP.
VM, disques, gestion GKE, NAT/IP, trafic, logs et GCS peuvent être facturés.
Le budget PROD précédemment autorisé de 20 USD/mois n’est pas un accord pour
un cluster permanent. Aucun budget/coupe-circuit n’est défini dans ces roots.

Voir les [validations conservées](foundation/VALIDATION-2026-11-11.md), la
[procédure PROD](foundation/MIGRATION-PROD-2026-11-11.md) et les
[incidents](../docs/Troubleshoot.md). C05–C08 restent hors de ces roots : aucun
service applicatif serverless n’est déployé par ce nettoyage.
