# Standardisation PROD — audit et procédure du 11 novembre 2026

**Statut : PRÉPARATION UNIQUEMENT, NON EXÉCUTÉE.** Décision de l'utilisateur :
« Non, préparer seulement la migration », le gel des écritures des autres
opérateurs n'étant pas confirmé. L'absence de run GitHub ou de verrou au moment
de l'audit ne prouve pas qu'une session Terraform d'un autre poste ne peut pas
démarrer. La migration est donc différée, conformément à cette consigne.
Aucun `terraform apply`, `terraform destroy` ou transfert de state n'a été lancé.

Les [preuves filtrées de préparation](migration-prod-preparation-2026-11-11.json)
confirment les sauvegardes, les lineages/serials et l'absence de modification des
huit states, des buckets et du VPC/subnet pendant cette intervention.

## Convention opérationnelle

| Stack | Environnement | Fichiers | Préfixe définitif |
| --- | --- | --- | --- |
| Foundation | prod | prod.tfvars, backends/prod.hcl | foundation/prod |
| GKE | prod | prod.tfvars, backends/prod.hcl | gke/prod |
| Runners | prod | prod.tfvars, backends/prod.hcl | runners/prod |
| Bootstrap | prod | prod.tfvars, backends/prod.hcl | bootstrap/prod |

Le projet est toujours `masterpoulet-prod`. Les configurations GKE et runners
ont été vérifiées dans C04 à `1ae9c75` ; leurs backends utilisent déjà la
convention définitive. Aucun state PROD GKE/runners, ancien ou nouveau, n'a été
trouvé dans les buckets examinés : aucune migration de ces stacks n'est à faire.
Le state bootstrap PROD existe et reste inchangé.

## Source historique et destination

Les chemins anciens de cette section sont des identifiants de source et de
rollback, jamais des paramètres d'exploitation quotidienne.

| Propriété | Source historique | Destination canonique |
| --- | --- | --- |
| URI | gs://masterpoulet_prod_bucket/foundation/prd/default.tfstate | gs://masterpoulet_prod_bucket/foundation/prod/default.tfstate |
| Génération actuelle auditée | 1792763537877160 | 1793714422833208 |
| Lineage | 7e009275-d640-4fa0-8a3a-e5d7656547e0 | 8176c273-dfb3-c80e-efc1-ed1031e16915 |
| Serial | 5 | 1 |
| Ressources | VPC et subnet PROD | Aucune |
| Outputs | network_id, subnet_cidr, subnet_id | Aucun |

La destination est un state Terraform structurellement valide mais vide,
sans ressource, output ou résultat de contrôle à préserver. Elle a été
sauvegardée elle aussi ; sa génération reste restaurable. Une destination qui
change ou devient non vide invalide cette préparation : arrêter et réauditer.

Les deux adresses propriétaires sont :

- `google_compute_network.vpc` : `projects/masterpoulet-prod/global/networks/masterpoulet-prod-vpc`.
- `google_compute_subnetwork.subnet` : `projects/masterpoulet-prod/regions/europe-west3/subnetworks/masterpoulet-prod-vpc-subnet`.

Les identifiants concordent avec les ressources réellement décrites sur GCP.
L'inventaire porte sur huit states et ne trouve aucun autre propriétaire actif
de ces deux ressources. Aucun objet de verrou GCS ni processus Terraform local
n'était présent ; aucun run Actions en cours ou en file n'était présent.

## Sauvegardes et restauration

Les octets exacts des générations source et destination ont été téléchargés et
vérifiés par taille, MD5 GCS et SHA256. Les copies sont **hors Git**, dans :

```text
%LOCALAPPDATA%/Codex/secure-state-backups/prod-standardization-20261111-172045/
  foundation-source-archive.tfstate
  foundation-destination-before-empty.tfstate
  backup-manifest.json
```

Le répertoire a une ACL sans héritage autorisant seulement l'utilisateur Windows
et SYSTEM ; les deux fichiers héritent uniquement de ces droits. Le versioning
du bucket est activé et les deux générations d'origine sont encore lisibles.
Les dumps, le cache Terraform et les plans binaires restent hors Git.

Rollback préparé, non exécuté :

1. Garder le gel de tous les opérateurs et pipelines ; ne lancer aucun apply.
2. Avant toute copie, contrôler les générations courantes et comparer le state
   avec le manifeste. Un changement externe impose une nouvelle analyse.
3. Si la migration n'a pas écrit la destination, la source reste l'autorité
   historique inchangée ; aucune restauration distante n'est nécessaire.
4. Si la copie a été faite mais aucun apply n'a suivi, vérifier que source et
   destination possèdent les mêmes ressources, outputs et lineage. Le retour
   temporaire d'un unique opérateur au backend historique peut se faire par une
   reconfiguration locale explicite, sans recopier ni supprimer de state.
   Aucun autre consommateur ne doit écrire pendant ce retour.
5. En cas de corruption, sélectionner la génération sauvegardée ou le fichier
   privé correspondant et faire revoir sa restauration sous gel. Ne jamais
   écraser une génération courante inconnue ni utiliser de copie forcée.

Le state historique ne doit pas être supprimé pendant la migration. Après une
migration réussie, il devient une archive de rollback ; tous les consommateurs
actifs doivent rester sur le préfixe canonique, sans deux autorités écrivantes.

## Procédure officielle préparée

La copie doit utiliser [Terraform init -migrate-state](https://developer.hashicorp.com/terraform/cli/commands/init),
sans copie forcée. Le backend [GCS supporte les verrous](https://developer.hashicorp.com/terraform/language/backend/gcs).
Dans Terraform 1.16.6, la migration verrouille source et destination et les
relit sous ces verrous avant la confirmation ; l'ancien state est conservé.

Un `TF_DATA_DIR` privé neuf a déjà été initialisé explicitement sur la source
historique. Workspace `default` unique, liste des deux ressources et concordance
avec la sauvegarde sont vérifiés. Les commandes suivantes sont une procédure
conditionnelle, pas la preuve d'une migration exécutée :

```sh
# Initialisation explicite de la source historique, dans le répertoire privé dédié.
terraform init -backend-config=backends/prod.hcl -backend-config=prefix=foundation/prd -input=false -lockfile=readonly
terraform workspace show
terraform state list

# Seulement après gel confirmé et nouveau contrôle des deux générations.
terraform init -migrate-state -backend-config=backends/prod.hcl -lock=true -lock-timeout=60s -lockfile=readonly
```

Exécuter ces commandes depuis la foundation complète C04 revue, dans le même
`TF_DATA_DIR` privé. Ne pas utiliser `-reconfigure` pour la seconde commande,
ni désactiver le verrouillage. Accepter uniquement la copie vers un backend
confirmé vide. Toute demande d'écrasement d'un state non vide impose un refus.

Après copie, avant de lever le gel :

1. Vérifier le cache backend : bucket PROD et préfixe canonique.
2. Vérifier les deux ressources et leurs IDs, tous les attributs et outputs,
   ainsi que la continuité du lineage/serial.
3. Vérifier que la génération et les octets de la source historique sont inchangés.
4. Vérifier que les six autres states et les ressources GCP sont inchangés.
5. Refaire fmt, validate, state list et le plan PROD depuis le backend canonique.
6. Vérifier les consommateurs CI et les postes opérateurs avant de lever le gel.

## Plan de référence réellement exécuté

Un vrai plan a été exécuté depuis le backend propriétaire historique, avec la
foundation complète C04 `1ae9c75` : **exit 2, deux créations, une mise à jour,
zéro suppression, zéro remplacement**.

| Ressource | Action | Détail |
| --- | --- | --- |
| google_compute_network.vpc | no-op | VPC existant reconnu |
| google_compute_subnetwork.subnet | update en place | Ajout Pods 10.32.0.0/21 et Services 10.32.8.0/24 |
| google_compute_router.router | create | masterpoulet-prod-vpc-router, europe-west3, VPC PROD |
| google_compute_router_nat.nat | create | masterpoulet-prod-vpc-nat, AUTO_ONLY, subnet PROD et toutes ses plages |

Ce n'est **pas encore un plan post-migration**. La destination canonique reste
vide tant que le gel n'est pas confirmé et que la copie n'a pas été exécutée.
Le plan ci-dessus ne doit pas être appliqué dans cette intervention.

La PR C04 reste ouverte. Sa configuration complète sert de référence pour les
plages GKE, absentes du code foundation de cette branche basée sur main. Ne pas
appliquer une révision plus ancienne qui retirerait les plages utilisées en DEV.
Les plages PROD prévues n'ont pas de chevauchement dans l'inventaire précédent ;
le nouvel examen des dépendances GCP reste requis avant un futur apply PROD.

## Références historiques conservées

Les occurrences de l'ancienne abréviation sont limitées à :

- `AUDIT.md` : archive des commandes et observations du 23 octobre.
- `VALIDATION-2026-11-11.md` : archive de l'audit précédant cette préparation.
- `infra/validation/evidence/2026-11-11.json` : preuve immuable de cet ancien audit,
  explicitement archivée dans son README.
- `docs/Troubleshoot.md` : description de l'incident et lien vers ce statut actuel.
- Le présent rapport et ses preuves : chemin source historique nécessaire à la
  migration et au rollback.

Aucun fichier backend, tfvars, script opérationnel ou workflow n'utilise cette
ancienne abréviation comme nom d'environnement actif.
