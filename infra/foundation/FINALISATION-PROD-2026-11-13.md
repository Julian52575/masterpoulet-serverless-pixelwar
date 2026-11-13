# Finalisation Terraform/GCP — contrôle du 13 novembre 2026

La foundation PROD est complète et son plan final est sans changement. Deux
ressources ont été créées : `masterpoulet-prod-vpc-router` et
`masterpoulet-prod-vpc-nat`, en `europe-west3`. Le subnet existant a reçu les
plages Pods `10.32.0.0/21` et Services `10.32.8.0/24` en place. Aucun VPC,
subnet, bucket, cluster ou runner supplémentaire n'a été créé ; aucune
suppression ni aucun remplacement n'a été effectué.

GKE et ARC PROD restent **non déployés par cette intervention** : le budget
confirmé par l'utilisateur est **20 USD/mois**. L'API GKE est désactivée, donc
l'absence de cluster PROD ne peut pas être certifiée. Aucun 403 n'a été traité
comme une preuve d'absence. La mission complète reste partiellement bloquée.

Les [preuves filtrées](finalisation-prod-2026-11-13.json) contiennent les
générations, checksums, propriétaires et plans avant/après. Les dumps de states,
plans binaires et kubeconfig restent hors Git, sous le dossier privé existant
`%LOCALAPPDATA%/Codex/secure-state-backups/prod-standardization-20261111-172045/prod-final-20261113/`.
Les sauvegardes téléchargées sont vérifiées par taille et MD5 GCS ; les SHA256
sont conservés dans les preuves. Le dossier hérite des ACL privées du parent.

| Ressource | DEV | PROD | Action effectuée | Résultat |
| --- | --- | --- | --- | --- |
| VPC | masterpoulet-dev-vpc | masterpoulet-prod-vpc | Réutilisation | Identifiants GCP conservés, aucun doublon physique |
| Subnet | 10.0.1.0/24, europe-west1 | 10.0.2.0/24, europe-west3 | Mise à jour PROD en place | Identifiant et plage primaire préservés |
| Plages secondaires | Pods 10.16.0.0/21, Services 10.16.8.0/24 | Pods 10.32.0.0/21, Services 10.32.8.0/24 | Ajout PROD | Présentes dans GCP et foundation/prod |
| Cloud Router | Existant | masterpoulet-prod-vpc-router | Création PROD | Bon VPC et bonne région |
| Cloud NAT | Existant | masterpoulet-prod-vpc-nat | Création PROD | AUTO_ONLY, subnet PROD, ALL_IP_RANGES |
| Bucket GCS | masterpoulet_bucket | masterpoulet_prod_bucket | Aucun changement | Deux backends bootstrap convergents |
| State Terraform | Quatre stacks existantes | Foundation propriétaire de quatre ressources ; GKE/runners vides | Foundation PROD seule mise à jour | Neuf autres states inchangés |
| Cluster GKE | masterpoulet-dev-gke, présent | Inventaire inaccessible : API désactivée | Lecture DEV ; plan PROD seulement | Aucun déploiement PROD |
| Node pool | github-runners, un nœud Ready, autoscaling 1–2 | Aucun dans le state ; aucune VM observée | Aucune création | Budget insuffisant pour le plan GKE |
| ARC / Runners | Deux releases deployed, contrôleur/listener Running | Aucun dans le state ; accès cluster non établi | Référence du Secret corrigée dans le code importé | DEV plan sans changement ; aucune installation PROD |

## Audit, ownership et migration

Branche conservée : `feature/c02-final-validation`, HEAD `ed30310`. Les quatre
fichiers déjà modifiés ou ajoutés à l'arrivée ont été conservés. `main` distant
et la [PR C04 #12](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/pull/12)
ont été consultés en lecture uniquement : base main `af889d6`, C04 `1ae9c75`, PR
ouverte et non fusionnée. Aucun checkout, switch, commit, push ou merge.

La migration officielle du 12 novembre est **déjà effective** : au début de
l'intervention, `foundation/prod` possède VPC/subnet, lineage
`7e009275-d640-4fa0-8a3a-e5d7656547e0`, serial 6, génération
`1794508272471576` selon les preuves. Aucune migration n'a été répétée ; aucun
besoin de confirmation de gel pour une nouvelle migration ne s'est présenté.
L'archive historique `foundation/prd` reste byte pour byte inchangée, serial 5.
Elle n'est jamais utilisée comme backend opérationnel par cette intervention.
Le contrôle après application trouve le même lineage canonique, serial 8.

Les dix states courants trouvés dans les buckets visibles des deux projets ont
été inventoriés. Les seules références dupliquées concernent VPC/subnet PROD
dans l'archive historique et le state canonique : elles ne correspondent pas à
deux ressources physiques. Aucun autre propriétaire accessible n'a été trouvé.
L'absence de state extérieur inaccessible ou d'un ancien poste opérateur
écrivain ne peut pas être garantie ; l'équipe doit maintenir l'archive sans
écrivain conformément au compte rendu de migration.

Avant apply : mêmes générations des dix states, aucun verrou, aucune VM ni
Router PROD et aucun run actif dans les cent derniers runs Actions consultés.
Cette observation n'est pas une nouvelle confirmation de gel des opérateurs.
Le plan enregistré a été contrôlé puis appliqué sous verrou Terraform.
L'environnement GitHub prod reste sans règle de protection ; aucune protection
distante n'a été modifiée. Un plan runners DEV exécuté en parallèle du relevé
final a temporairement posé son verrou ; le contrôle après sa fin confirme
l'absence de verrou résiduel et la stabilité de toutes les générations finales.

Après apply, seul `foundation/prod` a changé. Les neuf autres states, dont les
quatre DEV, ont les mêmes générations et checksums. Toutes les sections de
l'inventaire GCP DEV sont identiques avant/après. Les VPC PROD, buckets et
ressources non concernées sont conservés. Les réseaux default restent hors scope.

## Plans réellement exécutés

Chaque couple stack/environnement utilise un TF_DATA_DIR privé distinct,
workspace default, le backend `backends/<env>.hcl` et `<env>.tfvars` correspondants.
Google 7.46.1 et Helm 3.3.0 sont réutilisés avec lockfile readonly. Les plans
utilisent le refresh réel, detailed-exitcode et un verrou avec délai de 60 s.
`fmt -check` et `validate` réussissent pour les huit couples.

| Stack | DEV | PROD |
| --- | --- | --- |
| bootstrap | Exit 0, zéro changement | Exit 0, zéro changement |
| foundation | Exit 0, zéro changement | Avant : exit 2, 2 ajouts / 1 modification / 0 destruction ; apply réussi ; après : exit 0, zéro changement |
| gke | Exit 0, zéro changement | Exit 2, 4 ajouts / 0 modification / 0 destruction ; NON APPLIQUÉ |
| runners | Exit 0, zéro changement | Exit 2, 2 ajouts / 0 modification / 0 destruction ; NON APPLIQUÉ |

Le plan GKE PROD comprend cluster, pool github-runners, service account des nœuds
et liaison `roles/container.defaultNodeServiceAccount`. La configuration conserve
nodes privés, Workload Identity GKE, endpoint DNS IAM, suppression protégée,
e2-standard-2, disque pd-standard 30 Go et autoscaling 1–2 en europe-west3-b.
Un plan de création depuis un state vide ne prouve pas qu'un cluster est absent
ou que l'API permettra son déploiement.

Le provider Helm cible explicitement le contexte PROD
`gke_masterpoulet-prod_europe-west3-b_masterpoulet-prod-gke`. Aucun kubectl PROD
n'a été redirigé sur DEV. Son plan depuis le state vide n'a pas validé une
connexion Kubernetes ; namespaces, releases et Secret PROD restent inconnus.
Le namespace arc-runners et le Secret doivent préexister pour un futur apply.

Le contrôle DEV a seulement lu les noms/types de Secrets, les namespaces,
releases, Pods, nœuds et la référence du Secret de l'AutoscalingRunnerSet.
Le Secret existant est `github-pat-arc`, et non `arc-rw` dans le code C04.
L'alignement de cette référence dans le code importé ramène le plan runners DEV
à zéro changement. Aucun apply DEV, import de bucket, test de destruction,
PAT nouveau ou contenu de Secret n'a été utilisé.

L'inventaire authentifié des runners directement dans GitHub n'a pas pu être
réalisé : gh n'a pas de session authentifiée disponible et le connecteur ne
fournit pas l'endpoint correspondant. Les objets ARC et leur listener ont été
vérifiés dans Kubernetes. Aucun smoke test susceptible de déclencher un job
n'a été lancé. Le même dépôt GitHub dispose déjà de l'installation DEV ; aucune
exigence imposant une deuxième installation PROD n'a été identifiée dans les
configurations C04 et workflows examinés. Le sujet externe complet et la décision
de l'équipe restent à confirmer ; aucun runner PROD n'est créé automatiquement.

## APIs, quotas, coûts et blocages

Les deux projets sont ACTIVE et rattachés au même compte de facturation actif.
Compute, IAM et Service Usage sont activés en PROD ; container.googleapis.com
ne l'est pas. L'identité d'audit possède le rôle Owner sur les deux projets ;
aucun rôle n'a été ajouté. La disponibilité de tous les futurs droits Kubernetes
ne peut pas être déduite du rôle GCP.

Quotas compute régionaux PROD observés : 200 CPU, 24 E2 CPU, 4096 Go de disque,
8 adresses en usage, consommations nulles avant l'intervention. Ils permettent
la capacité du plan, mais ne plafonnent pas les dépenses mensuelles. Aucun
chevauchement avec les plages secondaires proposées dans les subnets des deux
projets et leurs routes non default ; aucun peering du VPC cible.

La lecture des budgets échoue avec SERVICE_DISABLED pour billingbudgets sur le
projet consommateur DEV. L'API DEV n'a pas été activée. On ne peut conclure ni
qu'un budget existe ni qu'il est absent. Aucun mécanisme de coupure automatique
n'est déclaré dans ces stacks.

Tarifs officiels revérifiés le 13 novembre :

- [GKE](https://cloud.google.com/kubernetes-engine/pricing) : 0,10 USD/cluster/heure,
  soit environ 73 USD sur 730 h avant crédit. Le crédit de 74,40 USD est par
  compte de facturation, partagé avec DEV ; il ne constitue pas une seconde
  gratuité PROD. VM, disques, logs et réseau s'ajoutent. GKE PROD permanent ne
  peut pas être validé dans le budget autorisé de 20 USD/mois.
- [Cloud NAT](https://cloud.google.com/nat/pricing) : jusqu'à 32 VM, 0,0014 USD
  par VM utilisatrice/heure, 0,005 USD par IPv4/heure, 0,045 USD/GiB traité, plus
  sortie réseau. Avec une IPv4 et 1–2 VM sur 730 h, cela ferait environ
  4,67–5,69 USD/mois hors trafic. Actuellement, aucune VM PROD n'est observée et
  get-nat-ip-info ne retourne aucune adresse allouée. Ce constat ne constitue
  pas un plafond de facture future. GCS/versioning/opérations restent facturables.

Pour poursuivre GKE, il faut une décision de budget ou d'architecture différente,
puis rendre l'inventaire GKE PROD accessible, vérifier son résultat et les états
historiques, contrôler les prérequis et refaire le plan. Pour ARC PROD, confirmer
d'abord son besoin ; ne pas dupliquer l'installation DEV par défaut. Aucun
plan GKE/runners sauvegardé aujourd'hui ne doit être appliqué sans ces contrôles.

## Modifications Git et limites de vérification

Les définitions nécessaires sont reprises de C04 1ae9c75 sur la branche courante :
plages secondaires foundation et tfvars distincts, stacks infra/gke et
infra/runners, lockfiles et documentation associée. Le Secret référencé dans
scale-set.tf est corrigé ; aucune valeur secrète n'est versionnée. Le README
foundation et l'incident ARC dans docs/Troubleshoot.md sont actualisés en
conservant les changements préexistants. Le présent rapport et ses preuves sont
nouveaux. Aucun workflow ou script opérationnel n'utilise prd comme cible active.
Les occurrences restantes sont historiques. Les ressources applicatives C05–C08
n'ont pas été modifiées.

GitNexus impact a été exécuté avant édition. Les définitions Terraform donnent
UNKNOWN, sans appelants/processus résolus, et l'extension FTS est indisponible :
ce n'est pas un avis de faible risque. Les recherches complémentaires, IDs,
inventaires, contrôles des plages/routes, plans et dépendances réseau ont fourni
la revue nécessaire. L'impact du journal Troubleshoot est LOW, avec CONTRIBUTOR
puis README en amont et aucun processus. Après actualisation de l'index, le
contrôle structuré detect_changes scope all couvre 40 fichiers et 74 symboles ;
la comparaison à origin/main couvre 71 fichiers et 101 symboles. Les deux
retournent LOW, zéro processus affecté, partial=false et truncated=false.
Un index Git temporaire permet d'inclure les fichiers nouveaux sans modifier
l'index Git réel, dont le checksum a été vérifié. Ces résultats ne compensent
pas l'absence de résolution des dépendances Terraform : les plans réels et
inventaires restent les contrôles déterminants. Le format Terraform et
git diff --check réussissent. Aucun test applicatif n'a été lancé, le code
applicatif étant inchangé. Les résultats de graphe détaillés sont conservés
dans les fichiers d'audit locaux ignorés.
