# GKE — pools système et workers DEV/PROD

[Guide et coûts](../README.md) · [Recette ARC](../runners/README.md)

## Architecture et audit du 20 novembre 2026

Les clusters Standard zonaux existants sont conservés. Ce root gère deux
pools, le cluster, le compte des nœuds, son IAM et l'API GKE déjà dans les
states. Réseau, NAT, buckets, WIF et application restent dans leurs stacks.

| Paramètre | DEV | PROD |
| --- | --- | --- |
| Projet / cluster | masterpoulet-dev / masterpoulet-dev-gke | masterpoulet-prod / masterpoulet-prod-gke |
| Région / zone unique | europe-west1 / europe-west1-b | europe-west3 / europe-west3-b |
| Bucket / préfixe, workspace default | masterpoulet_bucket / gke/dev | masterpoulet_prod_bucket / gke/prod |
| deletion_protection conservée | false | true |
| system | 1 e2-medium fixe, sans autoscaling | identique |
| github-runners | e2-standard-2, total 0–2 | identique |
| Disques | 30 GiB pd-standard par nœud | identique |

Les workers conservent le nom github-runners et l'adresse Terraform
google_container_node_pool.runners. Aucun troisième pool, déplacement de
state ou remplacement de cluster. Labels : workload=system et workload=worker.
Seuls les workers portent workload=worker:NoSchedule ; seuls les runners ARC
le tolèrent. Controller/listener sélectionnent le système. Les agents GKE
DaemonSet nécessaires restent sur chaque nœud et sont inclus dans le budget.

Les workers utilisent total_min_node_count=0, total_max_node_count=2 et
initial_node_count=0, sans node_count. Le lifecycle ignore uniquement la taille
initiale pour laisser l'autoscaler agir. Les bornes sont totales ; les pools
sélectionnent actuellement une seule zone. Le système utilise node_count=1,
sans bloc autoscaling. Types, disques, capacité, labels et taints sont
configurables ; maintenir leur correspondance avec le root runners.

Nœuds privés, Workload Identity/GKE_METADATA, identités, scopes, Secure Boot,
COS_CONTAINERD, Dataplane V2, canal REGULAR et auto-repair/upgrade sont conservés.
Les upgrades gardent max_surge=0, max_unavailable=1 : le seul nœud système
constitue un point de défaillance et les upgrades interrompent ARC brièvement.
Les endpoints IP restent désactivés ; l'accès DNS reste authentifié par IAM.

Les deux clusters sont RUNNING en 1.36.4-gke.2377000 avec un seul pool, un
e2-standard-2 permanent, 30 GiB et autoscaling 1–2. Les 18 pods observés sont
Kubernetes et ARC ; aucun pod Pixel War. L'application du dépôt est serverless
et n'est pas déplacée. L'inventaire Cloud Run/Functions PROD ne retourne aucun
service : sa disponibilité publique ne peut pas être attestée ici, sans
endpoint applicatif de référence. Aucun changement applicatif n'est effectué.

## Pourquoi e2-medium

Chaque cluster demande **930m CPU et 1 756 927 616 octets (1 675,54 MiB)**,
conteneurs secondaires compris. Une e2-small de 2 GiB offre au plus environ
**1 436 MiB** après réservations GKE : 25 % puis 100 MiB d'éviction.
Le déficit d'au moins **239,54 MiB** l'exclut, indépendamment des consommations.

Une e2-medium de 4 GiB offre théoriquement **2 972 MiB et 940m CPU**
(réservation CPU E2 partagées : 1 060m). Le noyau voit moins que la RAM nominale :
lire Allocatable après création. Les requests CPU controller/listener passent
de 100m à **50m chacune**, avec 1–3m mesurés ponctuellement, en gardant limites
500m/256Mi et requests mémoire 128Mi. Le budget devient **830m**, laissant
110m, dont 50m pour le pod supplémentaire d'un rolling update du controller.
La marge mémoire théorique reste d'environ 1 296 MiB. Ne pas ajouter d'autres
workloads permanents.

e2-medium est le plus petit candidat E2 compatible avec ces requests, **à
valider sur le nœud réel avant bascule**. Les addons peuvent adapter leurs
requests et une mesure ponctuelle ne prouve pas la tenue sous charge.
Si Allocatable ne suffit pas, qu'un rollout reste Pending ou qu'une pression
CPU/RAM apparaît, conserver l'ancien pool permanent et revoir le type système
avec un nouveau plan. Ne pas réduire les réservations ni supprimer les agents.
30 GiB gardent une marge raisonnable pour images, agents et logs.

Sources : [réservations GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/plan-node-sizes),
[E2 partagées](https://docs.cloud.google.com/compute/docs/general-purpose-machines).

## Plans et drift

Plans distants analysés sans apply le 20 novembre :

| Root | DEV | PROD |
| --- | --- | --- |
| foundation | aucun changement | 2 créations : Router et NAT manquants |
| gke | 1 création system, 1 modification workers, 0 suppression | identique |
| runners | 0 création, 2 mises à jour en place, 0 suppression | identique |

Les plans GKE ne modifient ni cluster, réseau, secondaires, IAM, ni API.
Le code initial omettait google_project_service.container pourtant dans les
states : la déclaration avec disable_on_destroy=false est rétablie.
Les noms Helm réels masterpoulet-dev-gke / masterpoulet-prod-gke sont préservés.
DEV rétablit aussi atomic=true du controller, déjà déclaré dans le code.

Les secondaires PROD sont présentes. Aucun Router/NAT n'est retourné en PROD,
malgré des nœuds privés et une route Internet par défaut. **Bloquer les tests
runners PROD jusqu'à validation de la sortie GitHub/GHCR.** La restauration
foundation est proposée par un plan indépendant, sans changement de code
réseau dans cette branche ; son application exige une approbation explicite.
Private Google Access ne remplace pas une sortie Internet vers GitHub.

## Migration progressive — DEV puis PROD

**Chaque apply ci-dessous exige l'approbation explicite du plan correspondant.
Aucun apply n'a été exécuté.** Attendre la fin des runners actifs et coordonner
les jobs. Ne pas appliquer le plan GKE complet avant validation d'ARC sur system.
Depuis la racine du dépôt, PowerShell :

~~~powershell
$tfEnv = 'dev'
$gcpProject = 'masterpoulet-dev'
$gkeZone = 'europe-west1-b'
$gkeCluster = 'masterpoulet-dev-gke'
$env:TF_DATA_DIR = "$PWD/tmp/gke-$tfEnv"
$env:GOOGLE_OAUTH_ACCESS_TOKEN = gcloud.cmd auth print-access-token
terraform '-chdir=infra/gke' init -input=false -lockfile=readonly "-backend-config=backends/$tfEnv.hcl"
terraform '-chdir=infra/gke' workspace show
terraform '-chdir=infra/gke' state list
terraform '-chdir=infra/gke' validate
terraform '-chdir=infra/gke' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" '-target=google_container_node_pool.system' "-out=$tfEnv-system.tfplan"
terraform '-chdir=infra/gke' show "$tfEnv-system.tfplan"
# Après approbation du plan ciblé uniquement :
terraform '-chdir=infra/gke' apply "$tfEnv-system.tfplan"
gcloud.cmd container clusters get-credentials $gkeCluster "--zone=$gkeZone" "--project=$gcpProject" --dns-endpoint
$kubeContext = 'gke_{0}_{1}_{2}' -f $gcpProject,$gkeZone,$gkeCluster
kubectl "--context=$kubeContext" get nodes -L workload,cloud.google.com/gke-nodepool
kubectl "--context=$kubeContext" describe nodes -l workload=system
kubectl "--context=$kubeContext" get pods -A -o wide
~~~

Le ciblage est une exception de migration. Son plan doit créer uniquement
system sans modifier cluster ou ancien pool. Vérifier Ready, Allocatable,
requests, agents et DNS. Déplacer ensuite ARC en gardant l'ancien minimum à 1 :

~~~powershell
$env:TF_DATA_DIR = "$PWD/tmp/runners-$tfEnv"
terraform '-chdir=infra/runners' init -input=false -lockfile=readonly "-backend-config=backends/$tfEnv.hcl"
terraform '-chdir=infra/runners' validate
terraform '-chdir=infra/runners' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" "-out=$tfEnv-arc.tfplan"
terraform '-chdir=infra/runners' show "$tfEnv-arc.tfplan"
# Après approbation :
terraform '-chdir=infra/runners' apply "$tfEnv-arc.tfplan"
kubectl "--context=$kubeContext" -n arc-systems rollout status deployment/arc-gha-rs-controller --timeout=300s
kubectl "--context=$kubeContext" -n arc-systems get pods -o wide
kubectl "--context=$kubeContext" -n arc-runners get autoscalingrunnersets
~~~

Vérifier controller ET listener Ready sur system, puis la capacité pour tous
les autres pods permanents. Les nouveaux runners attendent encore le label
worker posé à l'étape suivante : ne pas envoyer de job avant la fin de bascule.

~~~powershell
$env:TF_DATA_DIR = "$PWD/tmp/gke-$tfEnv"
$env:GOOGLE_OAUTH_ACCESS_TOKEN = gcloud.cmd auth print-access-token
terraform '-chdir=infra/gke' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" "-out=$tfEnv-workers.tfplan"
terraform '-chdir=infra/gke' show "$tfEnv-workers.tfplan"
# Après approbation : uniquement adaptation du pool workers existant.
terraform '-chdir=infra/gke' apply "$tfEnv-workers.tfplan"
gcloud.cmd container node-pools list "--cluster=$gkeCluster" "--zone=$gkeZone" "--project=$gcpProject"
kubectl "--context=$kubeContext" get nodes -L workload
kubectl "--context=$kubeContext" get pods -A -o wide
kubectl "--context=$kubeContext" get events -A --sort-by=.lastTimestamp
~~~

NoSchedule n'évince pas les pods déjà placés. L'autoscaler doit pouvoir
déplacer les pods système non-DaemonSet vers system. Sur GKE 1.36, les pods
kube-system récents peuvent retarder le retrait d'au moins une heure.
Lire PDB, annotations et événements avant intervention. Aucun pool actif
n'est supprimé : github-runners est adapté en place.
Replanifier GKE/runners après migration ; aucun changement résiduel attendu.

Après réussite de la [recette ARC](../runners/README.md#recette-après-déploiement),
reprendre toute la procédure avec ces valeurs PROD :

~~~powershell
$tfEnv = 'prod'
$gcpProject = 'masterpoulet-prod'
$gkeZone = 'europe-west3-b'
$gkeCluster = 'masterpoulet-prod-gke'
~~~

Avant cela, examiner et faire approuver le plan foundation PROD séparément,
avec son TF_DATA_DIR dédié, backends/prod.hcl et prod.tfvars. Ne pas appliquer
bootstrap, déplacer les states ou modifier WIF/IAM/secrets pour cette migration.

## Rollback sans recréer le cluster

Arrêter l'envoi de jobs et conserver system pendant le rollback.
Avec le code de cette branche et le TF_DATA_DIR GKE de la cible :

~~~powershell
terraform '-chdir=infra/gke' plan "-var-file=$tfEnv.tfvars" '-var=node_autoscaling={min=1,max=2}' '-var=worker_node_taints=[]' '-var=worker_node_labels={workload="github-runners"}' "-out=$tfEnv-rollback-workers.tfplan"
~~~

Après revue, approbation et application du plan enregistré, vérifier
github-runners Ready avant de déplacer ARC. Sélectionner le TF_DATA_DIR runners
de la même cible et préparer :

~~~powershell
terraform '-chdir=infra/runners' plan "-var-file=$tfEnv.tfvars" '-var=system_node_selector={"cloud.google.com/gke-nodepool"="github-runners"}' '-var=worker_node_selector={}' "-out=$tfEnv-rollback-arc.tfplan"
~~~

Après approbation/application, vérifier controller/listener et un job. Reporter
les surcharges dans une branche de rollback pour les rendre reproductibles.
Retirer system du code seulement après validation de son remplacement et revue
du plan de suppression du pool vide. Ne pas appliquer directement l'ancien
commit, qui pourrait supprimer system trop tôt. Ne jamais restaurer un vieux
state ni recréer le cluster.

## Diagnostic Kubernetes

Un kubeconfig périmé retournait NotFound. Rafraîchir les credentials avec
projet/zone/cluster et --dns-endpoint. Le provider Helm utilise kubeconfig_path
et config_context ; KUBECONFIG seul ne remplace pas son config_path. Un plan
recréant des releases déjà déployées doit faire vérifier cette connexion.

### Erreur node_locations

Conserver location=var.zone sur le cluster sans node_locations à ce niveau.
Chaque pool déclare [var.zone]. Ne pas changer la localisation d'un cluster
existant pour cette optimisation.

Validation : terraform fmt -check -recursive, terraform validate et
terraform test -var-file=dev.tfvars, puis prod.tfvars. Tests mockés, sans GCP.

Résultats du 20 novembre : fmt récursif réussi, validate réussi pour bootstrap,
foundation, GKE et runners ; quatre exécutions de tests Terraform réussies
(GKE/runners × DEV/PROD), 30 tests Python foundation réussis, quatre lints et
rendus Helm réussis, manifests vérifiés par kubectl en dry-run client sur les
deux clusters, actionlint 1.7.12 réussi sur le smoke test. Les mocks exigent
Terraform >=1.7 ; les contrôles ont utilisé Terraform 1.16.6.
Le lint Helm émet l'avertissement de fusion attendu pour githubConfigSecret,
une référence string au Secret existant plutôt que la table de valeurs par défaut.
Les tests applicatifs et les scénarios réels de charge/scale-to-zero n'ont pas
été exécutés. Aucun apply, destroy ou job GitHub n'a été déclenché.
