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
| system | 1 e2-small fixe, sans autoscaling | identique |
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

## Audit individuel et budget e2-small

L'audit du 20 novembre combine les manifests des deux clusters, metrics-server,
des maxima par conteneur sur une requête historique de sept jours et les pointes
simultanées sur 48 h stables. Les maxima historiques incluent les données
disponibles de plusieurs incarnations de pods, pas sept jours complets de charge.
Les deux clusters présentent les mêmes requests. Les valeurs DEV/PROD ci-dessous
proviennent d'une même collecte ; elles ne sont pas extrapolées entre projets.

Le calcul inclut les sidecars natifs initContainers/restartPolicy=Always :
cni-writer (5m/30Mi) et install-cni (1m/5Mi). Un init container terminé n'est pas
additionné à l'état stable ; son pic de scheduling doit aussi être vérifié.
Ici les requests des init containers classiques restent sous celles du pod actif.

| Pod ou préfixe | Requests actuelles CPU/RAM | CPU mesuré mCPU DEV/PROD | RAM mesurée MiB DEV/PROD | Somme des maxima RAM MiB DEV/PROD | Décision |
| --- | --- | --- | --- | --- | --- |
| ARC controller | 100m / 128.00Mi | 1.26/1.48 | 21.16/25.11 | 22.05/30.43 | 64Mi / 50m, limites conservées |
| ARC listener | 100m / 128.00Mi | 0.16/0.24 | 7.96/5.27 | 14.46/16.19 | 64Mi / 50m, limites conservées |
| anetd | 205m / 230.00Mi | 50.21/50.00 | 461.91/364.76 | 663.80/673.26 | conserver sans réduction |
| antrea autoscaler | 10m / 0.00Mi | 0.22/0.26 | 9.86/9.70 | 18.76/18.54 | conserver sans réduction |
| event-exporter | 3m / 100.00Mi | 0.15/0.43 | 40.34/32.89 | 49.21/60.87 | conserver sans réduction |
| Filestore lock controller | 10m / 40.00Mi | 0.84/1.09 | 29.10/32.31 | 38.28/41.22 | retirer (inutilisé) |
| Filestore node | 25m / 160.00Mi | 1.11/0.13 | 35.25/34.62 | 40.95/41.61 | retirer (inutilisé) |
| fluentbit | 105m / 230.00Mi | 12.03/13.04 | 93.98/82.61 | 151.80/161.34 | conserver sans réduction |
| metadata server | 100m / 100.00Mi | 1.11/0.42 | 24.61/26.33 | 30.23/29.29 | conserver sans réduction |
| metrics agent | 21m / 145.00Mi | 8.84/7.43 | 132.73/116.18 | 218.55/226.32 | conserver sans réduction |
| konnectivity | 15m / 60.00Mi | 7.45/5.87 | 34.88/32.50 | 42.78/42.72 | conserver sans réduction |
| konnectivity autoscaler | 10m / 9.54Mi | 0.25/0.24 | 11.24/9.39 | 18.59/18.12 | conserver sans réduction |
| kube-dns | 110m / 115.00Mi | 2.13/2.04 | 39.68/36.73 | 49.62/48.77 | conserver sans réduction |
| kube-dns autoscaler | 20m / 10.00Mi | 0.28/0.34 | 10.82/9.64 | 18.22/19.88 | conserver sans réduction |
| metrics-server | 43m / 55.00Mi | 3.30/2.86 | 20.76/23.60 | 26.13/35.49 | conserver sans réduction |
| netd | 8m / 65.00Mi | 0.70/0.10 | 85.99/63.91 | 169.80/171.96 | conserver sans réduction |
| NodeLocal DNSCache | 30m / 50.00Mi | 3.19/2.24 | 35.66/33.86 | 40.25/39.49 | retirer (cache facultatif) |
| PD CSI | 15m / 50.00Mi | 0.34/0.87 | 29.72/29.76 | 32.89/34.53 | retirer (inutilisé) |

La colonne maxima additionne les maxima mémoire évictable et non évictable
de chaque conteneur, sidecars natifs compris. C'est une borne conservatrice
par pod, pas une pointe simultanée de tous les pods. Elle ne doit pas être
sommée pour prédire la mémoire du nœud.

| Pod ou préfixe | Limites CPU/RAM par conteneur, identiques sur DEV/PROD |
| --- | --- |
| ARC controller | manager: 500m/256Mi |
| ARC listener | listener: 500m/256Mi |
| anetd | cilium-agent: sans/sans; cilium-agent-metrics-collector: 1/65Mi; cni-writer: sans/sans |
| antrea autoscaler | autoscaler: sans/sans |
| event-exporter | event-exporter: sans/sans; prometheus-to-sd-exporter: sans/sans |
| Filestore lock controller | filestore-lock-release-controller: 1/800Mi; filestorecsi-lockrelease-metrics-collector: 1/65Mi |
| Filestore node | gcp-filestore-driver: sans/sans; csi-driver-registrar: sans/sans; nfs-services: sans/sans; filestorecsi-metrics-collector: 1/65Mi |
| fluentbit | metadata-server-sidecar: sans/sans; fluentbit: sans/400Mi; fluentbit-metrics-collector: 1/65Mi |
| metadata server | gke-metadata-server: sans/200Mi |
| metrics agent | autoscaling-metrics-exporter: sans/50Mi; core-metrics-exporter: sans/50Mi; prometheus-metrics-collector: 1/80Mi |
| konnectivity | konnectivity-agent: sans/125Mi; konnectivity-agent-metrics-collector: 1/30Mi |
| konnectivity autoscaler | autoscaler: sans/sans |
| kube-dns | kubedns: sans/210Mi; kubedns-metrics-collector: 1/45Mi |
| kube-dns autoscaler | autoscaler: sans/sans |
| metrics-server | metrics-server: 43m/55Mi |
| netd | netd: sans/sans; netd-metrics-collector: 1/65Mi; install-cni: sans/sans |
| NodeLocal DNSCache | node-cache: sans/sans; nodelocaldns-metrics-collector: 1/65Mi |
| PD CSI | gce-pd-driver: sans/450Mi; pdcsi-metrics-collector: 1/30Mi; csi-driver-registrar: sans/50Mi |

« sans » signifie qu'aucune limite n'est déclarée pour cette ressource.
Certains agents gérés consomment plus que leur request ou n'ont pas de limite :
les requests ne sont pas un plafond physique. Aucun de ces agents n'est patché.

### Composants obligatoires et facultatifs

- Conserver anetd/antrea/netd : Dataplane V2, CNI, contrôleurs réseau ; ne pas
  réduire leurs requests. Les variantes anetd-xs/s observées ciblent la famille
  ek et ne s'appliquent pas aux E2 ; aucune économie fictive n'est comptée.
- Conserver metadata server et Workload Identity, konnectivity et son autoscaler,
  kube-dns, son autoscaler et metrics-server : identité, API, DNS et métriques.
- Conserver fluentbit, event-exporter et les agents de métriques système pour
  les diagnostics, la sécurité opérationnelle et l'observabilité pédagogique.
  SYSTEM_COMPONENTS reste activé ; Managed Prometheus était déjà désactivé.
  Les Deployments/DaemonSets gérés avec zéro pod ne sont pas comptés comme
  mémoire consommée et ne sont pas supprimés.
- Désactiver Filestore CSI : aucun PV/PVC/VolumeAttachment ni workload NFS.
  Cela retire filestore-node et filestore-lock-release-controller, **200Mi/35m**.
- Désactiver Persistent Disk CSI : aucun volume persistant ni runner en mode
  Kubernetes avec PVC. Gain **50Mi/15m**. Les boot disks et emptyDir n'utilisent
  pas ce driver. Réactiver et revalider la capacité avant tout futur besoin PVC.
- Désactiver uniquement le cache NodeLocal DNS, **50Mi/30m**. kube-dns et son
  Service restent actifs ; aucune plage IP, route ou règle de sécurité n'est
  modifiée. Sur trois nœuds au maximum, ce cache est une optimisation facultative,
  pas le service DNS. Sa désactivation provoque une rotation GKE des nœuds :
  prévoir une interruption ARC et attendre la fin de la rotation avant bascule.
- Ajuster uniquement ARC à **50m/64Mi par processus**, avec limites **500m/256Mi**
  conservées. Les maxima historiques par processus sont au plus 30,43Mi pour
  le controller, 16,19Mi pour le listener ; tous deux sans redémarrage observé.
  Le controller garde plus de 2× ce pic en request, le listener plus de 3×.
  Les maxima CPU moyennés sur 60s sont 8,26m et 3,15m ; les 50m ne les brident
  pas. Les limites ne sont pas abaissées pour masquer un manque de mémoire.

### Éviter les répliques DNS redondantes

Le ConfigMap existant kube-dns-autoscaler contient preventSinglePointFailure=true.
Avec deux nœuds, il peut demander deux répliques DNS ; le DNS ne tolère pas le
taint workers. Deux copies sur l'unique nœud système n'apportent aucune tolérance
à sa panne et ajoutent 115Mi/110m. Le budget ne doit pas ignorer cet effet.

Le root runners gère désormais **seulement la clé linear** de ce ConfigMap
existant, via kubernetes_config_map_v1_data et le provider Kubernetes 3.5.0.
Il conserve les autres paramètres et fixe min=1, max=1,
preventSinglePointFailure=false pour le périmètre 1 système + 0–2 workers.
Il ne remplace ni ConfigMap, ni Deployment DNS, ni Service, ni autoscaler.
Le mode force=true prend explicitement la propriété de cette seule clé,
actuellement détenue par cluster-proportional-autoscaler. Ce n'est pas une
suppression ou un déverrouillage de state. prevent_destroy protège la ressource
de données ; restaurer les paramètres avant un éventuel retrait du code.

### Budget et redémarrages

| Poste | RAM demandée MiB | CPU demandé mCPU |
| --- | ---: | ---: |
| État réellement observé | 1 675,54 | 930 |
| Retrait Filestore + PD CSI | −250 | −50 |
| Retrait du cache DNS facultatif | −50 | −30 |
| Ajustement mesuré ARC | −128 | −100 |
| **État stable cible, 14 pods** | **1 247,54** | **750** |
| Rolling update controller : une copie supplémentaire | +64 | +50 |
| Rolling update DNS : une copie supplémentaire | +115 | +110 |
| **Budget pour le plus grand rollout individuel connu** | **1 362,54** | **860** |

Une e2-small offre théoriquement 1 436Mi allocatables (2GiB moins 25 % puis
100Mi d'éviction) et 940m CPU schedulables (réservation GKE E2 partagées 1060m).
Cela laisse **188,46Mi/190m au repos**, **124,46Mi pendant un rollout ARC**
et **73,46Mi/80m pendant un rollout DNS**. La RAM vue par le noyau est plus faible
que la RAM nominale : ce sont des plafonds théoriques, pas une mesure e2-small.
Son CPU soutenu est 0,5 vCPU, malgré les deux vCPU visibles au scheduler.

Sur les dernières 48h, hors CSI mais **cache DNS encore inclus**, les pointes
agrégées non évictables sont 1 041,45Mi DEV et 1 059,00Mi PROD. Les plafonds
conservateurs en ajoutant les pics évictables sont 1 189,66Mi et 1 272,59Mi
(pics de catégories non nécessairement simultanés). CPU agrégé maximal sur
60s : 155,99m DEV, 141,51m PROD. Ces mesures sont compatibles avec un petit
système ; elles ne couvrent ni deux jobs réels avec cette configuration,
ni un redémarrage complet sur e2-small.

Les DaemonSets observés utilisent maxSurge=0 et remplacent leurs pods.
Les Deployments ont généralement un surge d'une copie ; kube-dns utilise
maxSurge=10 %, maxUnavailable=0, soit une copie supplémentaire à une réplique.
Un redémarrage simple libère la place avant de repartir. Le budget réserve
le plus grand rollout individuel, mais **pas tous les rollouts simultanés** :
ARC + DNS ensemble demanderaient 1 426,54Mi et 910m, avec une marge nominale
de seulement 9,46Mi. Les opérations contrôlables doivent être séquentielles.
Les futures évolutions d'addons peuvent changer ces chiffres ; revalider après
chaque mise à jour GKE/chart.

**Faisabilité : candidat techniquement plausible avec ces optimisations,
pas encore homologué en PROD.** Avant scale-to-zero, lire Allocatable et
recalculer les requests effectives sur le nœud réel ; il doit couvrir l'état
stable plus la plus grande copie de rollout, soit au moins 1 362,54Mi/860m
si les manifests sont identiques. Vérifier DNS au repos/avec deux workers,
rollout controller, démarrage de deux runners, retour à zéro, absence d'OOM,
d'évictions et de pression mémoire/CPU. Garder l'ancien pool à min=1 tant
que ces contrôles ne passent pas. Un test Terraform ne valide pas la RAM.

Si cette marge réelle n'est pas disponible, arrêter la bascule. Ne pas
réduire les requests des agents GKE ni passer automatiquement à e2-medium.
L'alternative la moins coûteuse préservant les clusters est de garder
temporairement le pool existant 1–2 sans créer d'autre capacité permanente.
Une e2-medium coûterait environ 13,45 USD/mois DEV et 15,76 PROD de plus,
**uniquement après autorisation explicite**. Une migration Cloud DNS pourrait
retirer des pods DNS mais ajoute services facturés, migration DNS/nœuds et
risques ; elle n'est pas appliquée. Les VM Spot ne conviennent pas à ce nœud
système permanent. Supprimer logs/métriques économiserait de la RAM mais
réduirait l'observabilité ; cette option n'est pas retenue.

Sources : [réservations GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/plan-node-sizes),
[E2 partagées](https://docs.cloud.google.com/compute/docs/general-purpose-machines),
[Filestore CSI](https://docs.cloud.google.com/filestore/docs/csi-driver),
[PD CSI](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/gce-pd-csi-driver),
[cache DNS et rotation des nœuds](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache),
[autoscaler DNS](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/kube-dns),
[gestion de données ConfigMap](https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/config_map_v1_data).

## Plans et drift

Plans distants analysés sans apply le 20 novembre :

| Root | DEV | PROD |
| --- | --- | --- |
| foundation | aucun changement | 2 créations : Router et NAT manquants |
| gke | 1 création system, 2 modifications cluster/workers, 0 suppression | identique |
| runners | 1 adoption de données DNS, 2 mises à jour Helm, 0 suppression | identique |

Les plans GKE modifient uniquement addons_config du cluster en place, créent
system et adaptent workers. Ils ne changent ni identité/localisation du cluster,
réseau, secondaires, IAM ou API. La rotation des VM induite par NodeLocal DNS
n'apparaît pas comme un remplacement du cluster dans Terraform.
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
Aucun apply n'a été exécuté.** Attendre la fin des jobs. Ne pas appliquer
directement le plan complet : l'ordre est addons sur le pool existant → DNS →
création system → déplacement ARC → workers à zéro.

Depuis la racine du dépôt, initialiser le contexte et le backend DEV :

~~~powershell
$tfEnv = 'dev'
$gcpProject = 'masterpoulet-dev'
$gkeZone = 'europe-west1-b'
$gkeCluster = 'masterpoulet-dev-gke'
$kubeContext = 'gke_{0}_{1}_{2}' -f $gcpProject,$gkeZone,$gkeCluster
gcloud.cmd container clusters get-credentials $gkeCluster "--zone=$gkeZone" "--project=$gcpProject" --dns-endpoint
$env:TF_DATA_DIR = "$PWD/tmp/gke-$tfEnv"
$env:GOOGLE_OAUTH_ACCESS_TOKEN = gcloud.cmd auth print-access-token
terraform '-chdir=infra/gke' init -input=false -lockfile=readonly "-backend-config=backends/$tfEnv.hcl"
terraform '-chdir=infra/gke' workspace show
terraform '-chdir=infra/gke' state list
terraform '-chdir=infra/gke' validate
terraform '-chdir=infra/gke' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" '-target=google_container_cluster.gke' "-out=$tfEnv-addons.tfplan"
terraform '-chdir=infra/gke' show "$tfEnv-addons.tfplan"
# Après approbation : seulement les trois addons, sur l'ancien pool conservé.
terraform '-chdir=infra/gke' apply "$tfEnv-addons.tfplan"
kubectl "--context=$kubeContext" get nodes -L workload
kubectl "--context=$kubeContext" get pods -A -o wide
~~~

Attendre la fin de rotation des nœuds et la disparition des pods Filestore,
PD CSI et NodeLocal DNS ; vérifier la résolution DNS et ARC sur l'ancien pool.
Les fenêtres de maintenance GKE peuvent retarder la rotation. Ne pas confondre
addon désactivé dans l'API et configuration déjà effective sur tous les nœuds.

Gérer ensuite la clé DNS dans le root runners, avant toute création system :

~~~powershell
$env:TF_DATA_DIR = "$PWD/tmp/runners-$tfEnv"
terraform '-chdir=infra/runners' init -input=false -lockfile=readonly "-backend-config=backends/$tfEnv.hcl"
terraform '-chdir=infra/runners' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" '-target=kubernetes_config_map_v1_data.dns_autoscaler' "-out=$tfEnv-dns.tfplan"
terraform '-chdir=infra/runners' show "$tfEnv-dns.tfplan"
# Après approbation : adoption de linear dans le ConfigMap existant.
terraform '-chdir=infra/runners' apply "$tfEnv-dns.tfplan"
kubectl "--context=$kubeContext" -n kube-system get configmap kube-dns-autoscaler -o yaml
kubectl "--context=$kubeContext" -n kube-system get deployment kube-dns
~~~

Vérifier min/max=1 et une réplique DNS Ready. Les ciblages sont des exceptions
de migration, pas le fonctionnement courant. Créer system sans changer workers :

~~~powershell
$env:TF_DATA_DIR = "$PWD/tmp/gke-$tfEnv"
terraform '-chdir=infra/gke' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" '-target=google_container_node_pool.system' "-out=$tfEnv-system.tfplan"
terraform '-chdir=infra/gke' show "$tfEnv-system.tfplan"
# Après approbation : uniquement création system.
terraform '-chdir=infra/gke' apply "$tfEnv-system.tfplan"
kubectl "--context=$kubeContext" describe nodes -l workload=system
kubectl "--context=$kubeContext" get pods -A -o wide
~~~

Vérifier Ready, Allocatable réel, budget et marge de rollout. Si insuffisants,
arrêter ici et garder l'ancien pool permanent. Ne pas envoyer de job pendant
la bascule : les nouveaux runners attendent le label worker de l'étape finale.

~~~powershell
$env:TF_DATA_DIR = "$PWD/tmp/runners-$tfEnv"
terraform '-chdir=infra/runners' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" "-out=$tfEnv-arc.tfplan"
terraform '-chdir=infra/runners' show "$tfEnv-arc.tfplan"
# Après approbation :
terraform '-chdir=infra/runners' apply "$tfEnv-arc.tfplan"
kubectl "--context=$kubeContext" -n arc-systems rollout status deployment/arc-gha-rs-controller --timeout=300s
kubectl "--context=$kubeContext" -n arc-systems get pods -o wide
$env:TF_DATA_DIR = "$PWD/tmp/gke-$tfEnv"
$env:GOOGLE_OAUTH_ACCESS_TOKEN = gcloud.cmd auth print-access-token
terraform '-chdir=infra/gke' plan -input=false -lock-timeout=60s "-var-file=$tfEnv.tfvars" "-out=$tfEnv-workers.tfplan"
terraform '-chdir=infra/gke' show "$tfEnv-workers.tfplan"
# Après approbation et validation controller/listener sur system :
terraform '-chdir=infra/gke' apply "$tfEnv-workers.tfplan"
kubectl "--context=$kubeContext" get nodes -L workload
kubectl "--context=$kubeContext" get pods -A -o wide
kubectl "--context=$kubeContext" get events -A --sort-by=.lastTimestamp
~~~

NoSchedule n'évince pas les pods existants. Vérifier que l'autoscaler peut
déplacer tous les pods permanents vers system. Les pods kube-system peuvent
retarder le retrait d'au moins une heure. Ne pas supprimer un pool actif.
Replanifier GKE/runners sans -target après migration ; aucun drift attendu.

Après réussite de la [recette ARC](../runners/README.md#recette-après-déploiement),
reprendre toute la procédure avec les quatre valeurs PROD :

~~~powershell
$tfEnv = 'prod'
$gcpProject = 'masterpoulet-prod'
$gkeZone = 'europe-west3-b'
$gkeCluster = 'masterpoulet-prod-gke'
~~~

Avant PROD, faire approuver séparément son plan foundation si sa sortie
Internet reste absente. Bootstrap, WIF, IAM et secrets ne sont pas à appliquer.

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
Conserver les optimisations DNS/CSI pendant ce rollback des pools. Pour les
annuler aussi, restaurer d'abord les valeurs linear historiques via un plan
Terraform revu, puis réactiver les addons dans un plan GKE séparé et attendre
la rotation des nœuds. Le service kube-dns reste actif dans les deux cas.
Ne pas détruire la ressource de données DNS (prevent_destroy). Retirer system
du code seulement après validation de son remplacement et revue du plan de
suppression du pool vide. Ne pas appliquer directement l'ancien
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
