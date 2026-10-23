# ARC — préparation du contrôleur officiel via Terraform

[Guide infrastructure](../README.md) · [GKE](../gke/README.md) · [Réseau](../foundation/README.md)

Cette stack prépare **uniquement le contrôleur GitHub Actions Runner Controller
(ARC)** de l'architecture officielle **Autoscaling Runner Scale Sets**. Elle ne
crée pas de cluster, de VM, de runner scale set, de GitHub App ou de credential
GitHub. Aucun déploiement n'a été effectué pendant cette étape.

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
| `backends/dev.hcl`, `backends/prd.hcl` | Buckets existants et préfixes propres aux runners. |
| `providers.tf` | Provider Helm et contexte kubeconfig explicite dérivé du projet, de la zone et du cluster. |
| `variables.tf` | Paramètres du cluster existant, version stable et ressources du contrôleur. |
| `dev.tfvars`, `prd.tfvars` | Cibles DEV et PROD ; PROD est préparé uniquement. |
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
