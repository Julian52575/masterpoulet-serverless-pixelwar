# Validation C02 Terraform / GCP — 11 novembre 2026

Trois objectifs sont validés. L'objectif 2 reste bloqué : le state propriétaire
PROD et le backend configuré diffèrent, et le plan dépasse l'ajout des plages.
Aucune modification du réseau partagé DEV ou PROD n'a été appliquée.

| Objectif | État initial | Actions effectuées | État final | Preuves |
| --- | --- | --- | --- | --- |
| 1 — Router/NAT DEV | Ressources présentes, quatre ressources foundation gérées | Lectures GCP et state, vrai plan C04 | DÉJÀ RÉALISÉ | Plan final code 0 ; Router/NAT dans foundation/dev |
| 2 — Secondary ranges PROD | Plages absentes ; VPC/subnet dans foundation/prd ; foundation/prod vide | Inventaire, comparaison de 88 CIDR, deux plans sans apply | BLOQUÉ | Backend configuré : quatre créations ; backend propriétaire : Router/NAT à créer et subnet à modifier |
| 3 — Buckets GCS IaC | Deux buckets existants, aucun propriétaire Terraform dans les configurations/states accessibles | Stack bootstrap indépendante ; deux imports uniquement | CORRIGÉ ET VALIDÉ | Plans finaux 0 ; métadonnées des buckets et cinq anciens states inchangés |
| 4 — Apply / Destroy / Recreate | Aucune preuve complète trouvée | Deux cycles VPC/subnet temporaires en DEV ; contrôle GCP et nettoyage | CORRIGÉ ET VALIDÉ | Deux plans d'idempotence 0 ; deux suppressions confirmées ; state de test vide |

Preuves publiques, sans state ni plan binaire :
[`infra/validation/evidence/2026-11-11.json`](../validation/evidence/2026-11-11.json).
Les sorties intégrales et les plans locaux restent dans le dossier ignoré
`.gitnexus/c02-final-validation-20261111-155054/`.

## Préparation et source du code

`git status` était propre. Après `git fetch origin --prune`, main était
`af889d6` ; la branche `feature/c02-final-validation` a été créée depuis cette
référence, sans écraser de travail local. Les PR #7 et #9 sont fusionnées, mais
[C04 #12](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/pull/12)
reste ouverte. Sa configuration complète à `1ae9c75` a été consultée dans un
worktree détaché pour les plans réseau : main ne contient pas encore les plages
secondaires GKE DEV. Aucun code C04 n'a été réintroduit dans cette branche.

Le compte actif gcloud et les ADC correspondent ; les permissions nécessaires
ont été testées via les API IAM sans modifier l'IAM. Chaque commande GCP choisit
explicitement son projet. Aucun token ou credential n'a été publié.

## 1 — Router et NAT DEV

`masterpoulet-dev-vpc-router` et `masterpoulet-dev-vpc-nat` existent en
`europe-west1`, sur le VPC `masterpoulet-dev-vpc`. NAT utilise `AUTO_ONLY`,
`LIST_OF_SUBNETWORKS` et `ALL_IP_RANGES` pour le subnet attendu.
Le state `foundation/dev` possède VPC, subnet, Router et NAT ; aucun des autres
states examinés ne possède ces ressources. Les plans initial et final indiquent
zéro changement : aucune réparation n'a été exécutée.

GKE DEV est `RUNNING` et utilise ce réseau/subnet, avec les plages Pods
`10.16.0.0/21` et Services `10.16.8.0/24`. Il n'a jamais servi au test de destruction.

## 2 — PROD : arrêt avant application

Le subnet `masterpoulet-prod-vpc-subnet`, région `europe-west3`, conserve sa plage
primaire `10.0.2.0/24` ; ses secondaires sont absentes. Les plages prévues
`10.32.0.0/21` et `10.32.8.0/24` n'entrent en conflit avec aucune des 88 plages
DEV/PROD inventoriées. Aucun peering, instance Compute ou forwarding rule n'a
été trouvé dans l'inventaire PROD. L'inventaire GKE PROD reste NON CONFIRMÉ :
l'API GKE est désactivée et répond 403. Elle n'a pas été activée.

Deux states distincts existent dans `masterpoulet_prod_bucket` :

- `foundation/prd/default.tfstate`, serial 5, possède le VPC et le subnet réels.
- `foundation/prod/default.tfstate`, serial 1, est vide.

Le backend actuellement déclaré vise `foundation/prod`. Son dernier plan propose
quatre créations, dont le VPC/subnet déjà existants : aucune application.
Un autre répertoire local de données Terraform a servi à lire le backend
historique, sans migration. Ce plan propose deux créations (Router et NAT) et
une mise à jour du subnet avec les plages ; aucune suppression ni remplacement,
mais le périmètre dépasse l'ajout des plages demandé : aucune application.

Il faut d'abord faire valider le backend propriétaire et le périmètre du changement
PROD. Aucun `state rm`, `state mv`, `init -migrate-state`, import en double,
suppression d'objet GCS ou apply ciblé de contournement n'a été exécuté.

## 3 — Adoption des buckets existants

La nouvelle stack [`infra/bootstrap`](../bootstrap/README.md) gère un bucket par
state, dans son projet d'origine. Les deux buckets sont en `EUROPE-WEST1`, avec
versioning, Uniform Bucket-Level Access, prévention d'accès public forcée et
soft delete de 604800 secondes. Les restrictions de chiffrement et les deux
règles existantes sur les versions non courantes sont conservées ; aucune
rétention verrouillée ni modification IAM n'a été ajoutée.

La recherche a couvert dix références distantes, les cinq states d'origine et
les autres buckets des projets accessibles : aucun propriétaire de ces buckets
n'y a été trouvé. Les plans d'adoption contenaient chacun exactement un import
et zéro création, modification, suppression ou remplacement. Après les imports :

- DEV : `bootstrap/dev/default.tfstate`, plan final 0.
- PROD : `bootstrap/prod/default.tfstate`, plan final 0.
- `prevent_destroy = true` et `force_destroy = false` sont déclarés.
- Les métadonnées brutes des buckets sont identiques avant/après.
- Les générations, empreintes MD5 et contenus hachés des cinq anciens states
  sont identiques avant/après toute la mission.

Seuls deux nouveaux states d'adoption ont été écrits ; aucun bucket ou objet de
state existant n'a été supprimé ou migré.

## 4 — Reproductibilité isolée

La stack [`infra/validation`](../validation/README.md) est indépendante et cible
exclusivement DEV. Exécution `20261111-150221-3a89` :

- VPC : `c02-validation-20261111-150221-3a89`.
- Subnet : `c02-validation-20261111-150221-3a89-subnet`, `europe-west1`, `10.250.240.0/28`.
- State : `gs://masterpoulet_bucket/validation/c02/20261111-150221-3a89/default.tfstate`.
- Noms initialement absents et CIDR vérifié libre dans l'inventaire courant.
- Cycle 1 : deux créations, présence GCP, plan 0, deux suppressions, absence GCP.
- Cycle 2 : mêmes noms recréés, nouveaux identifiants GCP, plan 0, deux suppressions,
  absence GCP et state final vide, serial 9.

Chaque plan a été lu en JSON et contrôlé avant application : uniquement les deux
adresses de test, les noms attendus, le projet DEV et les actions de l'étape.
Aucune VM, adresse publique, NAT, connexion au réseau partagé ou ressource PROD
n'a été créée. Le state de test vide est conservé comme preuve ; aucun objet GCS
n'a été effacé. Ce test prouve VPC/subnet, pas la recréation de GKE ou ARC.

## Commandes de vérification exécutées

- Git : status, fetch, comparaison main/C04 et examen des PR #7/#9/#12.
- gcloud : auth/config, projects describe, IAM testIamPermissions, réseaux,
  subnets, routers/NAT, instances, forwarding rules, clusters, services activés,
  buckets, listes d'objets et métadonnées. Les states ont été lus en mémoire et
  filtrés, sans afficher leurs valeurs sensibles.
- Terraform 1.16.6, provider Google 7.46.1 verrouillé : fmt -check, init,
  workspace show, validate, state list, plans réels et plans JSON filtrés.
- Imports : apply de deux plans ne contenant que l'import du bucket existant.
- Test : apply de plans de création ou destruction limités au VPC/subnet temporaires.
- Comparaisons finales des cinq states d'origine et des métadonnées des buckets.
- GitNexus impact et recherche de références avant édition ; analyse des changements
  avant les commits. Les nouvelles racines ont un risque UNKNOWN faute d'appelants
  résolus, complété par les recherches de propriété et les contrôles des plans.

## Points restants

Les quatre objectifs C02 ne sont pas tous validés : l'objectif 2 reste bloqué.
Attendre l'intégration de C04 ou coordonner sa base, résoudre explicitement le
choix du backend PROD et examiner les créations Router/NAT avant un nouveau plan.
Les configurations foundation existantes, les workflows, le code applicatif,
GKE, ARC et l'IAM n'ont pas été modifiés.
