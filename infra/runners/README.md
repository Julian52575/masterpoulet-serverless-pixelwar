# ARC — contrôleur et runner scale set sur GKE DEV

[Guide infrastructure](../README.md) · [GKE](../gke/README.md) · [Réseau](../foundation/README.md)

Cette stack gère le contrôleur **Actions Runner Controller (ARC)** et le
**runner scale set** officiel. Elle utilise le cluster existant et un Secret
GitHub géré hors Terraform. Elle ne crée ni cluster, ni VM, ni credential GitHub.

## État vérifié le 30 octobre 2026

- Backend GCS DEV : `masterpoulet_bucket`, préfixe `runners/dev`, workspace `default`.
- Contrôleur existant `arc` : chart `0.15.0`, Deployment disponible `1/1`,
  service account `arc-controller` dans `arc-systems`.
- Namespace `arc-runners` et Secret `github-pat-arc` présents ; seul le nom du
  Secret a été consulté, jamais sa valeur.
- Plan enregistré et appliqué : **1 création, 0 modification, 0 suppression**,
  uniquement `helm_release.arc_runner_scale_set`. Plan après application : aucun changement.
- Les deux releases Helm sont `deployed`, mais le scale set est **Pending** :
  GitHub refuse l'enregistrement avec `403 Resource not accessible by personal access token`.
  Aucun listener ni runner n'a donc pu démarrer. Une release Helm déployée ne
  prouve pas qu'un job peut s'exécuter.
- Un nœud `Ready`, pool `github-runners` de type `e2-standard-2`, autoscaling
  activé de **1 à 2**. La montée à deux nœuds n'a pas été forcée.
- Workflow de démonstration préparé ; aucune exécution réussie ni suppression
  d'un runner après job n'est encore démontrée.

Le propriétaire du PAT doit vérifier le resource owner, le dépôt sélectionné,
la validité et la permission **Administration: Read and write**. Corriger le PAT
ou sa référence externe n'exige pas d'en copier la valeur dans Terraform.

## Architecture et paramètres du scale set

`controller.tf` reste inchangé. `scale-set.tf` ajoute une release dépendant de
`helm_release.arc_controller`, avec référence explicite à `arc-systems/arc-controller`.
Les namespaces et le Secret existants restent gérés hors de cette stack.

| Paramètre | Valeur |
| --- | --- |
| Release / `runs-on` | `masterpoulet-gke-runners` |
| Namespace | `arc-runners` |
| Chart officiel | `gha-runner-scale-set`, version `0.15.0` |
| Dépôt GitHub | `https://github.com/Julian52575/masterpoulet-serverless-pixelwar` |
| Secret existant / clé attendue | `github-pat-arc` / `github_token` |
| Runners au repos / maximum total | `0` / `2` |
| Image officielle du runner | `ghcr.io/actions/actions-runner:2.338.2` |
| Placement contrôleur, listener et runners | pool `github-runners` |
| Runner CPU : demande / limite | `500m` / `1` |
| Runner mémoire : demande / limite | `512Mi` / `1Gi` |
| Runner stockage éphémère : demande / limite | `1Gi` / `2Gi` |
| Listener CPU : demande / limite | `100m` / `500m` |
| Listener mémoire : demande / limite | `128Mi` / `256Mi` |

Le contrôleur réconcilie les objets ARC et enregistre le scale set auprès de
GitHub. Le listener écoute les jobs affectés au scale set et ajuste le nombre
de runners. Chaque runner exécute un job, puis ARC supprime le runner éphémère
et son Pod. `minRunners = 0` demande un retour à zéro runner lorsque les jobs
sont terminés ; le contrôleur et le listener restent présents.

Le chart officiel et ses valeurs ont été lus avec `helm show values ... --version
0.15.0` avant déploiement. Digest OCI du chart scale set observé :
`sha256:bdfdad17cf8e45ae064c73ed6764f0c75d4bf71a6e2912e6363a43d6dfc787de`.
L'image du runner est épinglée à la release officielle `2.338.2` ; revoir
régulièrement cette version pour conserver les correctifs et la compatibilité GitHub.

Les jobs utilisent des commandes Linux directement dans le conteneur : aucun
Docker-in-Docker, socket Docker ou mode Kubernetes de jobs conteneurisés.
Les conteneurs sont non root, sans élévation de privilèges, capabilities
retirées et seccomp `RuntimeDefault`. Les runners ne montent pas de jeton de
service account Kubernetes. Le répertoire de travail du runner reste inscriptible.

## Maintenance DEV

Les sections historiques plus bas conservent les vérifications de préparation
du 23 octobre ; elles ne décrivent pas le statut du déploiement du 30 octobre.
Exécuter les commandes suivantes depuis `infra/runners` :

```powershell
terraform init -reconfigure -backend-config="backends/dev.hcl" -input=false
if ($LASTEXITCODE -ne 0) { throw 'Backend DEV indisponible.' }
$arcBackend = Get-Content .terraform/terraform.tfstate -Raw | ConvertFrom-Json
if ($arcBackend.backend.type -ne 'gcs' -or $arcBackend.backend.config.bucket -ne 'masterpoulet_bucket' -or $arcBackend.backend.config.prefix -ne 'runners/dev') { throw 'Backend inattendu.' }
$arcWorkspace = terraform workspace show
if ($LASTEXITCODE -ne 0 -or $arcWorkspace -ne 'default') { throw 'Workspace inattendu.' }
terraform fmt -check -recursive
terraform validate
terraform state list
terraform plan -var-file="dev.tfvars" -input=false -lock-timeout=60s -out="dev-runners.tfplan"
if ($LASTEXITCODE -ne 0) { throw 'Plan impossible.' }
terraform show dev-runners.tfplan
```

Confirmer aussi le projet `masterpoulet-dev`, le cluster `masterpoulet-dev-gke`
et la zone `europe-west1-b`. Une fois le plan revu et autorisé, appliquer
uniquement le plan enregistré, puis refaire un plan et les contrôles Kubernetes.
Ne pas appliquer une suppression, un remplacement ou une modification inattendue.
Ne pas importer ou recréer une release déjà existante sans comprendre sa propriété.
Ne pas installer avec `helm install` en parallèle de Terraform.

## Vérifications et diagnostic

Dans un terminal PowerShell, imposer le contexte pour chaque commande :

```powershell
$arcContext = 'gke_masterpoulet-dev_europe-west1-b_masterpoulet-dev-gke'
kubectl --context=$arcContext get nodes -L cloud.google.com/gke-nodepool
kubectl --context=$arcContext get namespaces arc-systems arc-runners
kubectl --context=$arcContext -n arc-runners get secret github-pat-arc -o name
kubectl --context=$arcContext -n arc-systems get deployments,pods
kubectl --context=$arcContext -n arc-runners get pods
kubectl --context=$arcContext get autoscalingrunnersets,autoscalinglisteners,ephemeralrunnersets,ephemeralrunners -A
kubectl --context=$arcContext -n arc-runners get events --sort-by=.metadata.creationTimestamp
kubectl --context=$arcContext -n arc-systems get events --sort-by=.metadata.creationTimestamp
helm list --all-namespaces --kube-context $arcContext
```

Le listener se trouve normalement dans `arc-systems` ; chercher les Pods dans
les deux namespaces. Consulter localement les logs du contrôleur (`kubectl
--context=$arcContext -n arc-systems logs deployment/arc-gha-rs-controller
--since=10m`) et du Pod listener identifié, sans les publier bruts. Ne jamais
activer de logs debug susceptibles d'afficher des informations d'authentification.

| Symptôme | Vérifications |
| --- | --- |
| Scale set Pending, GitHub 403 | Propriétaire du PAT, dépôt autorisé et Administration en lecture/écriture ; ne pas remplacer par un rôle Kubernetes plus large. |
| GitHub 401 | Validité, expiration ou révocation du PAT à vérifier par son propriétaire. |
| Secret introuvable | Nom et namespace `arc-runners` ; arrêter le déploiement, sans demander la valeur du PAT. |
| Listener absent | Conditions du scale set, logs du contrôleur, RBAC vers `arc-controller`. |
| Runner Pending | Événements, requests, capacité disponible, label du pool, taints et état du cluster autoscaler. |
| ImagePullBackOff | Accès GHCR via NAT et existence de l'image ; ne pas désactiver TLS. |
| Job en attente | Label `runs-on`, état du listener, droits GitHub, workflow/ref réellement présents sur GitHub. |

Un namespace vide n'est pas une preuve du retour à zéro après un job : vérifier
d'abord une exécution réussie et observer la création puis la suppression du Pod.

## Workflow et preuve d'exécution

`.github/workflows/arc-smoke-test.yml` utilise uniquement
`runs-on: masterpoulet-gke-runners`, `permissions: {}`, aucun checkout et aucun
secret supplémentaire. Il vérifie Linux et affiche le hostname et un message
de réussite. Le job a un timeout de trois minutes une fois démarré ; ce timeout
ne borne pas le temps passé dans la file d'attente.

Le premier push du fichier sur **feat/terraform-c04-gke** déclenche le test grâce
au filtre de branche et de chemin. Les autres fichiers ne déclenchent pas ce
workflow. `workflow_dispatch` ne devient disponible qu'après présence du
workflow sur la branche par défaut. Ne pas modifier les workflows de production.

Après correction du 403 et apparition d'un listener sain, pousser une seule fois
le commit autorisé, puis, si `gh` est connecté au dépôt :

```powershell
gh run list --repo Julian52575/masterpoulet-serverless-pixelwar --workflow arc-smoke-test.yml --branch feat/terraform-c04-gke --limit 1
# Reporter l'identifiant obtenu dans les commandes suivantes :
gh run watch RUN_ID --repo Julian52575/masterpoulet-serverless-pixelwar --exit-status
gh run view RUN_ID --repo Julian52575/masterpoulet-serverless-pixelwar --log
kubectl --context=$arcContext -n arc-runners get pods --watch
```

Commencer la surveillance des Pods avant le push : le job est court. Conserver
le lien du run, le runner attribué au job, le hostname, le succès de l'étape,
les événements de création/suppression et le retour à zéro runners. Un runner
seulement enregistré ne suffit pas. En cas de 403 persistant, ne pas envoyer
de job qui resterait en attente ; annuler un éventuel run déjà en file.

## Sécurité, rotation du PAT et coût

Le PAT fine-grained appartient à Julian, est limité au dépôt autorisé et exige
**Administration: Read and write** pour les jetons d'enregistrement. Ne jamais
lire la valeur du Secret, l'importer dans Terraform, l'afficher ou la committer.
`set_sensitive` ne protège pas le contenu du state ; la stack ne passe que le
nom du Secret. Les états, plans, kubeconfigs et credentials restent hors Git.

Pour la rotation, le propriétaire prépare un nouveau PAT de portée minimale
et le confie au mécanisme sécurisé qui gère déjà le Secret. Un opérateur autorisé
met à jour **le même Secret**, même namespace et clé `github_token`, sans
argument en clair, historique shell ou sortie de manifeste. Ne pas utiliser
`kubectl get secret -o yaml/json` ni une data source Terraform pour cette étape.
Attendre la réconciliation et vérifier l'absence de 401/403 ainsi qu'un vrai job.
Révoquer l'ancien PAT après validation, ou immédiatement s'il est compromis.
Si le contrôleur conserve un ancien client d'authentification en cache, un
redémarrage coordonné de son Deployment peut être nécessaire ; ne pas recréer
la release ou élargir ses permissions pour contourner le problème.

Le dépôt étant public, réserver les runners à des workflows de confiance ;
ne pas ajouter de déclenchement sur des contributions externes non approuvées.
Les jobs ont une connectivité réseau : l'éphémérité et l'absence de jeton
Kubernetes ne constituent pas une isolation réseau complète.

Deux runners demandent au total `1` CPU et `1Gi` de mémoire, en plus du
contrôleur, du listener et des composants système GKE. Vérifier les ressources
allouables et les requests existantes ; les limites ne réservent pas la capacité.
Zéro runner au repos n'implique pas zéro VM : le pool conserve au moins un nœud,
et contrôleur/listener, disques, NAT et logs continuent de consommer des ressources.

Pour tester le passage de 1 à 2 nœuds, convenir d'une fenêtre et d'un budget,
mesurer les requests déjà présentes, puis utiliser temporairement une charge
de confiance bornée qui laisse un runner Pending faute de capacité. Observer
les événements d'ordonnancement, les décisions du cluster autoscaler et le
second nœud Ready. Terminer la charge, vérifier la suppression des runners puis
le retour à un nœud après le délai du cluster autoscaler. Ne pas dépasser deux
runners, modifier les taints ou forcer le nombre de nœuds. Le smoke test seul
ne démontre pas cette montée en charge ; aucun test coûteux n'a été lancé ici.

## Nettoyage prévu, non exécuté

Arrêter les déclenchements et attendre la fin des jobs. Dans une modification
Terraform séparée et revue, retirer d'abord `helm_release.arc_runner_scale_set`,
planifier sur DEV et vérifier que seule cette release est supprimée. Après
autorisation explicite de ce nettoyage, appliquer le plan revu. Vérifier que
listener, runners et enregistrement GitHub ont disparu avant d'envisager le
retrait du contrôleur par un second changement Terraform. Ne jamais supprimer
les deux simultanément en ignorant les finalizers ARC. Ne pas forcer les
finalizers si GitHub est inaccessible.

Le Secret et le namespace préexistants restent hors propriété Terraform ; ne
pas les supprimer automatiquement. Les CRD peuvent subsister après retrait du
contrôleur : vérifier qu'aucun autre scale set ne les utilise. Les stacks GKE et
foundation ont un cycle de vie distinct. Aucune commande de destruction n'a été
exécutée pendant cette mission.

## Historique : préparation du contrôleur au 23 octobre 2026

Les sections suivantes décrivent l'étape initiale, avant le déploiement du
contrôleur puis l'ajout du scale set. Les mentions « futur » et « aucun
déploiement » ci-dessous s'appliquent uniquement à cette préparation historique.

## Ce que fait le contrôleur

Le contrôleur réconcilie les ressources ARC dans Kubernetes. Plus tard, un
runner scale set, son listener et son authentification GitHub permettront de
créer des runners éphémères en fonction des jobs. Le contrôleur seul n'enregistre
aucun runner dans GitHub et ne démontre pas le node autoscaling GKE.

L'installation est décrite par **une seule ressource Terraform** :
`helm_release.arc_controller`. Sa future application installera les objets du
chart, notamment le Deployment, le service account Kubernetes, les permissions
RBAC et les CRD ARC. Le namespace est demandé via `create_namespace = true`.
Le plan Terraform compte une release, pas chaque objet Kubernetes du chart.

Les fichiers de cette stack sont sa source de vérité : ne pas effectuer
d'installation ou de mise à niveau Helm manuelle en parallèle.

## Chart officiel et version vérifiée

| Paramètre | Valeur |
| --- | --- |
| Release | `arc` |
| Namespace | `arc-systems` |
| Chart | `oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller` |
| Version du chart / application | **0.15.0** |
| Répliques permanentes du contrôleur | **1** |
| Service account Kubernetes | `arc-controller` |
| Provider Helm verrouillé | `hashicorp/helm` **3.3.0**, contrainte `~> 3.0` |

La version a été vérifiée le **23 octobre 2026** dans la release officielle
`gha-runner-scale-set-0.15.0`, son `Chart.yaml` et le package OCI public lui-même
avec `helm show chart ... --version 0.15.0`. Digest OCI observé :

```text
sha256:20a369215b8c2ed981c4c0c75e56e6009564d51fffcbbd314d5da0ef82de253a
```

Il s'agit du chart stable officiel, pas du chart ARC legacy d'Artifact Hub,
ni des variantes expérimentales. Le digest est une trace de vérification ; le
code fixe la version, il n'impose pas ce digest ni une vérification de signature
du package. La version de Helm CLI installée sur un PC n'est pas celle du
provider Terraform ; le provider embarque son client Helm.

Avant toute mise à niveau, vérifier les notes GitHub, les évolutions CRD et
les valeurs du chart, puis produire un nouveau plan. Ne pas remplacer la version
par `latest` ou une plage implicite.

## Fichiers et états indépendants

| Fichier | Rôle |
| --- | --- |
| `backend.tf` | Backend GCS partiel, sans credential. |
| `backends/dev.hcl`, `backends/prod.hcl` | Buckets existants et préfixes propres aux runners. |
| `providers.tf` | Provider Helm et contexte kubeconfig explicite dérivé du projet, de la zone et du cluster. |
| `variables.tf` | Paramètres du cluster existant, version stable et ressources du contrôleur. |
| `dev.tfvars`, `prod.tfvars` | Cibles DEV et PROD ; PROD est préparé uniquement. |
| `controller.tf` | Release officielle, réplique, placement, sécurité et ressources. |
| `outputs.tf` | Release, namespace, version, service account et contexte utilisés. |
| `.terraform.lock.hcl` | Version et empreintes du provider à versionner. |
| `.gitignore` | Cache, states et plans locaux exclus de Git. |

| Cible | Projet / cluster / zone | Backend | State, workspace `default` |
| --- | --- | --- | --- |
| DEV | `masterpoulet-dev` / `masterpoulet-dev-gke` / `europe-west1-b` | `masterpoulet_bucket`, préfixe `runners/dev` | `runners/dev/default.tfstate` |
| PROD préparé | `masterpoulet-prod` / `masterpoulet-prod-gke` / `europe-west3-b` | `masterpoulet_prod_bucket`, préfixe `runners/prd` | `runners/prd/default.tfstate` |

Ces préfixes sont distincts de **foundation/dev**, **foundation/prd**,
**gke/dev** et **gke/prd**. Aucun bucket nouveau, migration de state ou accès
au backend PROD n'est nécessaire pour cette préparation DEV. Le state initial
runners DEV est vide. Le backend PROD n'a pas été initialisé ni planifié.

Les fichiers PROD sont nommés `prod.tfvars` et `backends/prod.hcl` ; le préfixe
historique `runners/prd` et le bucket restent inchangés, sans migration d'état.

## Connexion GKE sans secret dans Terraform

Le provider lit le kubeconfig **local** `~/.kube/config`, modifiable par
`kubeconfig_path`. Le chemin est développé localement ; aucun chemin privé
absolu n'est versionné. Il impose le contexte suivant en DEV, indépendamment
du contexte courant du terminal :

```text
gke_masterpoulet-dev_europe-west1-b_masterpoulet-dev-gke
```

Le kubeconfig doit utiliser `gke-gcloud-auth-plugin` en authentification exec.
Le jeton temporaire est obtenu par le client Kubernetes et n'est pas une
variable, une data source ou une valeur Helm Terraform. Aucun `google_client_config`
ne récupère de jeton à conserver dans le state. Le kubeconfig ne doit jamais
être committé, et son contexte doit réellement pointer vers le bon cluster.

Si le contexte manque, suivre la [connexion GKE](../gke/README.md#se-connecter-depuis-un-nouveau-pc-windows)
sur son propre PC, avec son propre compte. La commande de préparation locale est :

```powershell
gcloud.cmd auth login
if ($LASTEXITCODE -ne 0) { throw 'Connexion Google impossible.' }
gcloud.cmd auth application-default login
if ($LASTEXITCODE -ne 0) { throw 'Connexion ADC du backend impossible.' }
gcloud.cmd container clusters get-credentials masterpoulet-dev-gke --project=masterpoulet-dev --zone=europe-west1-b --dns-endpoint
if ($LASTEXITCODE -ne 0) { throw 'Contexte GKE DEV indisponible.' }
```

Ces connexions initiales ne sont pas exécutées automatiquement par Terraform.
Le plugin utilise normalement l'identité gcloud ; le backend GCS utilise les
ADC. Vérifier les deux identités. Installer kubectl et le plugin, disposer de
la connectivité DNS/HTTPS vers GKE et de l'accès public au chart GHCR. Aucun
login GHCR ni token GitHub n'est nécessaire pour ce chart public.

L'opérateur devra avoir les droits GCS sur le state, IAM d'accès GKE et les
autorisations Kubernetes nécessaires au namespace, Deployment, service account,
CRD et RBAC du chart, y compris les permissions de liaison/escalade éventuelles.
Les contrôles ponctuels d'accès ne prouvent pas tous les droits d'une future
installation. Ne pas contourner un refus par un autre credential ou des rôles
Owner. Aucun rôle GCP n'est créé par cette stack.

**Les seules valeurs Helm sont non secrètes.** Ne pas ajouter de PAT, clé privée
GitHub App, jeton ou contenu de Secret ici : Helm/Terraform peut conserver les
valeurs de release dans son state, même avec `set_sensitive`. Le futur scale set
devra référencer un Secret préexistant géré par une procédure séparée, sans en
faire transiter le contenu dans cette stack.

Le service account `arc-controller` est une identité **Kubernetes**, distincte
du compte GCP des nœuds. Lors d'une future installation, Kubernetes fournit son
authentification projetée et Helm conserve des métadonnées de release dans des
Secrets Kubernetes ; cela ne constitue pas un credential GitHub ni un secret
fourni dans nos valeurs Terraform.

## Placement, sécurité et budget

Le sélecteur `cloud.google.com/gke-nodepool = github-runners` cible le pool
existant. Son label a été vérifié en DEV, avec un nœud sans taint bloquant.
Aucune VM, aucun pool et aucune modification GKE ne sont déclarés. Un changement
ultérieur de label/taint ou un manque de ressources peut laisser le Pod Pending.

| Ressource du contrôleur | Demande | Limite |
| --- | --- | --- |
| CPU | `100m`, soit 0,1 CPU | `500m`, soit 0,5 CPU |
| Mémoire | `128Mi` | `256Mi` |

Ces valeurs initiales sont adaptées à une petite démonstration et devront être
mesurées en usage. Elles ne réservent pas la capacité des futurs runners. Le Pod
est non root, sans élévation de privilèges, avec capabilities retirées, seccomp
RuntimeDefault et système de fichiers racine en lecture seule. Le chart prévoit
un volume temporaire inscriptible. Les logs passent à info/JSON.

Une réplique est demandée, sans haute disponibilité ; un rollout peut
temporairement faire coexister des Pods selon la stratégie du chart. Le contrôleur
observe par défaut les namespaces avec le RBAC officiel ; son périmètre pourra
être restreint quand le namespace du futur scale set sera décidé. Il n'utilise
pas l'identité des nœuds pour administrer GitHub.

Le chart n'a pas de coût de licence ajouté ici, mais son Pod consommera CPU et
mémoire du pool. Une saturation peut contribuer au passage de 1 à 2 nœuds et
donc augmenter la facture. VM, disques, NAT, réseau et logs restent facturables
selon leur usage. L'installation du seul contrôleur ne prouve ni création de
runners dynamiques, ni node autoscaling. Voir [les coûts GKE](../gke/README.md).

## Vérifications DEV sans déploiement

Depuis la racine du dépôt :

```powershell
Set-Location infra/runners
terraform init -reconfigure -backend-config="backends/dev.hcl" -input=false
if ($LASTEXITCODE -ne 0) { throw 'Backend runners DEV indisponible.' }
$arcWorkspace = terraform workspace show
if ($LASTEXITCODE -ne 0 -or $arcWorkspace -ne 'default') { throw 'Workspace default requis.' }
$arcBackend = Get-Content .terraform/terraform.tfstate -Raw | ConvertFrom-Json
if ($arcBackend.backend.type -ne 'gcs' -or $arcBackend.backend.config.bucket -ne 'masterpoulet_bucket' -or $arcBackend.backend.config.prefix -ne 'runners/dev') { throw 'Mauvais backend.' }
terraform fmt -check -recursive
if ($LASTEXITCODE -ne 0) { throw 'Format incorrect.' }
terraform validate
if ($LASTEXITCODE -ne 0) { throw 'Configuration invalide.' }
terraform plan -var-file="dev.tfvars" -input=false -lock-timeout=60s -out="dev-runners.tfplan"
if ($LASTEXITCODE -ne 0) { throw 'Plan impossible : ne rien installer.' }
terraform show dev-runners.tfplan
```

Si un fichier doit être formaté, utiliser `terraform fmt` puis refaire le contrôle.
Ne pas afficher tout le kubeconfig ou les jetons pour diagnostiquer une erreur.
Un 403, un plugin manquant ou une connexion refusée est un blocage à résoudre
avec l'administrateur ; ne pas désactiver TLS ni changer de cible pour obtenir
un plan. Une vérification locale peut se limiter à `init -backend=false` et
`validate` sur un checkout neuf ; cela ne démontre pas l'accès GKE/GCS.

### Résultats de cette préparation, 23 octobre 2026

- Formatage et `terraform validate` réussis, provider signé HashiCorp installé.
- Backend GCS DEV et workspace `default` vérifiés, state runners initial vide.
- Plan réel : **1 ajout, 0 modification, 0 suppression**, exclusivement
  `helm_release.arc_controller`. Chart, version, release, namespace et projet
  du contexte DEV ont été contrôlés dans le JSON du plan.
- Plan local `dev-runners.tfplan`, cache et states locaux ignorés par Git.
- Contrôles DEV en lecture : contexte fonctionnel, plugin exec sans credential
  statique, pool compatible, aucune release ARC trouvée, namespace et CRD ARC
  absents. Autorisations ponctuelles de création namespace/CRD/ClusterRole : oui.
- L'initialisation et les accès réseau ont nécessité l'autorisation de sortie
  du sandbox local ; aucun contournement IAM/RBAC/TLS n'a été effectué.
- GitNexus exécuté avant édition : cible nouvelle absente, risque UNKNOWN,
  appelants/processus indéterminés ; recherche textuelle complémentaire effectuée.
- Aucun apply, destroy, installation Helm, changement de cluster ou accès
  PROD n'a été effectué. Les fichiers foundation, GKE et CI/CD sont conservés.

Le champ `status = deployed` éventuellement affiché dans le plan est une valeur
souhaitée du provider : il ne signifie pas que la release soit installée. Le
plan et les contrôles d'accès ne garantissent pas une future application réussie.
Une application ultérieure sera une étape distincte, revue et gérée uniquement
par Terraform, avec un nouveau plan si les prérequis ont changé.

## Étapes restantes pour connecter GitHub

1. Revoir puis installer ce contrôleur **via Terraform**, dans une étape autorisée.
2. Choisir le périmètre dépôt/organisation, le namespace des runners et une GitHub
   App avec permissions minimales ; cette identité n'est pas créée ici.
3. Préparer la gestion externe de son secret, sans valeur sensible dans les
   fichiers, values Helm, plans ou state de cette stack.
4. Déclarer séparément le chart officiel **gha-runner-scale-set**, avec référence
   au Secret existant et à `arc-systems` / `arc-controller`, puis définir les
   limites de runners et les requests/limits des jobs.
5. Créer un workflow de démonstration ciblant le scale set et démontrer d'abord
   des runners éphémères, puis le passage du pool GKE de 1 à 2 nœuds et son retour.
   Le cluster autoscaler réagit aux Pods Pending, pas directement à la file GitHub.
6. Mesurer coût et isolation des jobs avant un usage partagé. Lors d'un nettoyage,
   retirer les scale sets avant le contrôleur, puis runners avant GKE et foundation.

Helm ne supprime ni ne met systématiquement à niveau les CRD du dossier `crds/`
comme des ressources ordinaires. Le namespace créé par `create_namespace` peut
également subsister après désinstallation. Examiner propriété et dépendances
avant tout futur nettoyage ; ne pas supprimer les CRD utilisées par un autre
scale set ou contrôleur. Aucun nettoyage n'est exécuté dans cette étape.

Références officielles :

- [Démarrage Autoscaling Runner Scale Sets](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/get-started)
- [Release 0.15.0](https://github.com/actions/actions-runner-controller/releases/tag/gha-runner-scale-set-0.15.0)
- [Chart.yaml de cette version](https://github.com/actions/actions-runner-controller/blob/gha-runner-scale-set-0.15.0/charts/gha-runner-scale-set-controller/Chart.yaml)
- [Valeurs officielles](https://github.com/actions/actions-runner-controller/blob/gha-runner-scale-set-0.15.0/charts/gha-runner-scale-set-controller/values.yaml)
- [Provider Helm](https://registry.terraform.io/providers/hashicorp/helm/latest/docs)
