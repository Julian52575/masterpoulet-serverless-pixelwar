# C02 — contrôle frais DEV/PROD du 12 novembre 2026

**Statut C02 : NON TERMINÉ. Migration foundation PROD RÉUSSIE ET VÉRIFIÉE.**
Après l'audit initial, l'utilisateur a explicitement confirmé son accord et
celui de l'équipe pour le gel de toutes les opérations Terraform PROD, postes
opérateurs et GitHub Actions compris. La migration interactive officielle a
alors été exécutée et le plan canonique refait. Aucun apply, destroy, import,
déverrouillage forcé, suppression de state ou activation d'API n'a été lancé.
Les objectifs C02 1, 3 et 4 précédemment validés n'ont pas été rejoués.

Les [preuves filtrées du jour](validation-2026-11-12.json) enregistrent les
contrôles actuels. Les rapports du 11 novembre n'ont servi que de références
de comparaison, jamais de preuve suffisante de l'état présent.

## Révisions contrôlées et méthode

Après `git fetch origin --prune`, le répertoire de travail était propre sur
`feature/c02-final-validation`, `ed30310210c75ba327ca9cbf43ef9532e911fc9c`.
`origin/main` est `af889d6fc11725b08d3ea0743ede5e2cff70d52f` ; la branche locale
`main`, `1057234`, est en retard de six commits. Elle n'a pas été modifiée.

La [PR C04 #12](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/pull/12)
est ouverte, non draft, non fusionnée, à
`1ae9c75f6fd960a81511ae58bc511dcfc7117cfc`. Ses contrôles Terraform DEV/PROD et
SAST sont passés, mais son [run CI](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/actions/runs/43019642947)
échoue sur `dependencies-audit (backend)` et `stack` (attente des routes Traefik).
Ce statut ne constitue pas une validation complète permettant une fusion.
Aucune PR C02 n'apparaît dans l'inventaire distant au moment du contrôle.

| Stack | Dernier code complet disponible | Différence à prendre en compte |
| --- | --- | --- |
| Bootstrap | C02 `ed30310` | Adoption déjà effectuée ; ne pas répéter les imports |
| Foundation | C04 `1ae9c75` | Plages secondaires explicites absentes de C02 et main |
| GKE | C04 `1ae9c75` | Stack absente de C02 et main |
| Runners | C04 `1ae9c75` | Stack absente de C02 et main ; référence de Secret DEV incorrecte |

Le code C02 et C04 a été exporté depuis ces révisions dans deux répertoires
privés isolés. Aucun checkout, fusion ou modification de la branche C04.
Chaque couple stack/environnement utilise un `TF_DATA_DIR` distinct et le
workspace `default`. Versions : Terraform 1.16.6, Google 7.46.1, Helm 3.3.0,
selon les lockfiles existants, initialisés avec `-lockfile=readonly`.
Tous les plans utilisent le refresh réel, `-detailed-exitcode`, un verrouillage
actif avec délai de 60 secondes, et les tfvars de l'environnement.

Les deux projets ont été décrits avec `gcloud` et sont `ACTIVE` :
`masterpoulet-dev` (539044310096) et `masterpoulet-prod` (992884593424).
L'inventaire comprend les buckets, réseaux, subnets, routers/NAT, instances,
forwarding rules, comptes de service, IAM et clusters lorsque l'API est accessible.
Les objets de tous les cinq buckets visibles des deux projets ont été examinés.
La recherche des propriétaires porte sur leurs states courants accessibles ;
elle ne prouve pas l'absence d'un state externe ou inaccessible.

## DEV

`Oui (C04)` désigne le code complet à `1ae9c75`, pas une stack déjà fusionnée
dans C02. `0/0/0` signifie ajouter/modifier/détruire. Tous les contrôles fmt,
init et validate de ces quatre stacks ont réussi, code 0.

| Ressource / stack | Existe dans GCP | Dans le bon state | Configuration correcte | Action nécessaire | Plan réel exact |
| --- | --- | --- | --- | --- | --- |
| Bucket `masterpoulet_bucket` / bootstrap/dev | Oui | Oui | Oui | Aucune — DÉJÀ RÉALISÉ | Exit 0, 0/0/0 |
| VPC, subnet, Router et NAT / foundation/dev | Oui | Oui | Oui (C04) | Aucune — DÉJÀ RÉALISÉ | Exit 0, 0/0/0 |
| Cluster, node pool, SA nœuds et IAM / gke/dev | Oui | Oui | Oui (C04) | Aucune — DÉJÀ RÉALISÉ | Exit 0, 0/0/0 |
| Contrôleur ARC / runners/dev | Oui | Oui | Oui (C04) | Aucune | no-op dans le plan runners |
| Runner scale set ARC / runners/dev | Oui | Oui | Non (C04) | Modification de configuration à revoir ; aucun apply | Exit 2, 0 ajout, 1 modification en place, 0 destruction |

**DEV ne peut pas être marqué globalement « DEV — DÉJÀ RÉALISÉ ».** Le plan
runners change `githubConfigSecret: github-pat-arc` en `arc-rw`. Le Secret
`github-pat-arc` existe, `arc-rw` est absent, et l'AutoscalingRunnerSet réel
référence le premier. Seuls les noms et types de Secrets ont été affichés ;
aucune valeur de credential n'a été exposée ou ajoutée au code.

Les deux releases Helm sont `deployed` à la version 0.15.0, le nœud est Ready,
le contrôleur est à 1/1 et les pods contrôleur/listener sont Running. Cette
observation ne remplace pas un nouveau smoke test de job, qui n'a pas été lancé.
La correction recommandée est de conserver la référence du Secret existant dans
C04, puis de refaire un plan ; une rotation intentionnelle serait une opération
distincte à préparer. Le code C04 n'a pas été modifié automatiquement.

Les plans sans changement signalent néanmoins des écarts de refresh depuis les
anciens snapshots : normalisation du self-link NAT, versions GKE
`1.36.4-gke.1495002` vers `1.36.4-gke.2377000`, attributs calculés des nœuds,
labels `null` vers `{}`, et etag IAM. Aucune action n'est proposée sur ces
ressources. Un plan supplémentaire avec la foundation C02 courante retourne
également exit 0 ; il ne prouve pas qu'elle déclare les plages. Le schéma du
provider indique un bloc `secondary_ip_range` en mode attr-as-block ; pour
envoyer une liste vide, `send_secondary_ip_range_if_empty = true` est requis.
Le plan actuel conserve les plages lorsque le bloc est omis.
Pour un changement réseau futur, utiliser le code C04 complet revu.

## PROD

Tous les contrôles fmt, init et validate des quatre stacks réussissent, code 0.
Le backend GKE/runners utilise déjà la convention définitive. Un `state list`
vide ne permet pas de conclure à l'absence d'une ressource sur GCP. Les init GKE
et runners ont chacun initialisé un nouvel objet state vide au préfixe canonique ;
ils ne possèdent aucune ressource (voir l'effet de bord détaillé ci-dessous).

| Ressource / stack | Existe dans GCP | Dans le bon state | Configuration correcte | Action nécessaire | Plan réel exact |
| --- | --- | --- | --- | --- | --- |
| Bucket `masterpoulet_prod_bucket` / bootstrap/prod | Oui | Oui | Oui | Aucune | Exit 0, 0/0/0 |
| VPC `masterpoulet-prod-vpc` | Oui | Oui : foundation/prod | Oui (C04) | Aucune | no-op dans le nouveau plan canonique post-migration |
| Subnet `masterpoulet-prod-vpc-subnet` | Oui | Oui : foundation/prod | Oui (C04), plages non appliquées | Modification en place à examiner | update dans le même plan |
| Plages Pods/Services PROD | Non | Non | Oui (C04), non appliquée | Modification en place après revue | Ajout de 10.32.0.0/21 et 10.32.8.0/24 |
| Router PROD | Non | Non | Oui (C04), non appliquée | Création après revue | create dans le même plan |
| NAT PROD | Non | Non | Oui (C04), non appliquée | Création après revue | create dans le même plan |
| GKE : cluster et node pool | Inconnu | Non | Non opérationnelle : plages absentes, API non accessible | Blocage ; inventorier avant toute création | Exit 1 : postcondition des plages secondaires échouée ; plan incomplet |
| SA GKE nœuds et liaison IAM correspondante | Non | Non | Oui (C04), non appliquée | Créations conditionnelles après résolution des prérequis | Le plan incomplet annonce 2 ajouts ; pas un plan GKE validé |
| Releases ARC / runners/prod | Inconnu | Non | Non validée en situation réelle | Blocage ; vérifier le cluster, namespace et Secret avant création | Exit 2 : 2 ajouts, 0 modification, 0 destruction ; connexion PROD non vérifiée |

Le nouveau plan foundation est exécuté **après migration sur foundation/prod**,
avec C04 : **exit 2, 2 ajouts, 1 modification, 0 destruction, 0 remplacement**.
Fmt, validate, workspace default et les deux adresses de `state list` sont
revérifiés sur ce backend. Aucun écart de refresh n'apparaît dans ce plan PROD.
Le VPC est préservé ; le subnet conserve `10.0.2.0/24` et reçoit les deux plages.
Le Router `masterpoulet-prod-vpc-router` et le NAT `masterpoulet-prod-vpc-nat`
sont absents de l'inventaire réel. Le NAT prévu est `AUTO_ONLY`,
`LIST_OF_SUBNETWORKS`, `ALL_IP_RANGES` pour le subnet PROD en europe-west3.
Le contrôle de 88 plages IPv4 des deux projets ne trouve aucun chevauchement
avec les deux plages proposées. Aucun apply réseau ou GKE n'est autorisé ici.

`gcloud container clusters list --project=masterpoulet-prod` échoue en 403
`SERVICE_DISABLED` sur `container.googleapis.com`. L'alternative Cloud Asset
échoue aussi : API Cloud Asset désactivée sur le projet consommateur DEV de la
commande. Aucune API n'a été activée. L'absence de cluster/release PROD reste
**inconnue**, malgré l'absence de state, de SA nœuds, d'instances et de forwarding
rules PROD observée. Le plan runners depuis un state vide produit des créations
sans connexion validée au contexte PROD ; il ne peut servir de feu vert.

## States, propriété et sauvegardes

| Bucket | Préfixe courant inventorié | Propriétaire / contenu | Serial |
| --- | --- | --- | --- |
| masterpoulet_bucket | bootstrap/dev | Bucket DEV | 2 |
| masterpoulet_bucket | foundation/dev | VPC, subnet, Router, NAT DEV | 9 |
| masterpoulet_bucket | gke/dev | Cluster, node pool, SA et IAM DEV ; deux data sources réseau | 4 |
| masterpoulet_bucket | runners/dev | Deux releases ARC DEV | 4 |
| masterpoulet_bucket | validation/c02/20261111-150221-3a89 | Vide en ressources ; ancien test terminé | 9 |
| masterpoulet_prod_bucket | bootstrap/prod | Bucket PROD | 2 |
| masterpoulet_prod_bucket | foundation/prd (archive historique sans écrivain) | Copie de rollback VPC et subnet PROD | 5 |
| masterpoulet_prod_bucket | foundation/prod | Propriétaire canonique VPC et subnet PROD après migration | 6 |
| masterpoulet_prod_bucket | gke/prod | Nouveau state vide créé par init pendant cet audit | 1 |
| masterpoulet_prod_bucket | runners/prod | Nouveau state vide créé par init pendant cet audit | 1 |

L'inventaire initial compte huit states ; après init GKE/runners, il en compte
dix. Avant migration, les huit states préexistants conservaient exactement leurs
générations, métadonnées et hashes. La migration modifie uniquement le state
foundation/prod ; les neuf autres states, dont la source historique et les deux
nouveaux states vides, sont inchangés. Les ressources et métadonnées GCP inventoriées
(buckets, réseaux, subnets, routers, SA, IAM, clusters accessibles, instances,
forwarding rules) sont identiques entre les deux relevés.
Aucun autre state courant n'a été trouvé dans les buckets inspectés.
Aucun propriétaire géré dupliqué avant migration : les lectures `data` du réseau
par GKE ne sont pas une seconde propriété. Après migration, la détection brute
trouve les deux ressources dans l'archive historique et le state canonique,
avec le même lineage. C'est la copie de rollback conservée, pas une duplication
de ressources GCP. Il ne doit y avoir qu'un backend écrivain : foundation/prod.
Le retour d'un opérateur sur l'archive rendrait cette séparation invalide.
Aucun state GKE/runners PROD n'existait au
contrôle initial. L'initialisation réelle des backends a écrit deux objets
vides (181 octets chacun), sans ressource, output ou résultat de contrôle :

| Nouveau state canonique | Génération GCS | Lineage | Serial |
| --- | --- | --- | --- |
| gke/prod | 1794506998094827 | 1b549164-4bfc-3c56-17f8-2faf0b1288d4 | 1 |
| runners/prod | 1794507029591723 | ee7ebfd9-da35-1fb1-db5d-1496e19fcb23 | 1 |

Il s'agit d'un effet de bord de `terraform init`, pas d'une création de cluster
ou de release, ni d'une migration/import de ressource. Les deux nouveaux objets
ont été sauvegardés lors de l'inventaire final. Ils sont conservés ; aucune
suppression ou réécriture n'a été tentée pour revenir artificiellement à huit
states. Aucune migration de ces deux préfixes canoniques n'est nécessaire.
Un futur audit doit repartir de ces dix states, et non reprendre l'ancienne
hypothèse d'absence des deux objets.

| Propriété | Source historique | Destination canonique |
| --- | --- | --- |
| Génération GCS | 1792763537877160 | 1794508272471576 |
| Lineage | 7e009275-d640-4fa0-8a3a-e5d7656547e0 | 7e009275-d640-4fa0-8a3a-e5d7656547e0 |
| Serial | 5 | 6 |
| Ressources gérées | 2 | 2 |
| SHA256 | f5fe0934b6c4e003ac277321e856b29492b98ee855bbc01205baae9587e932a9 | 5f1e1015327b6cf6d12e30e208402a0e58c1263b0036e32562e3bdefa9640af0 |

Ces valeurs correspondent aux octets relus à une génération GCS précise,
contrôlés par taille et MD5, puis relus en métadonnées pour détecter une écriture
concurrente. Avant migration, la destination vide avait le lineage
`8176c273-dfb3-c80e-efc1-ed1031e16915`, serial 1, génération
`1793714422833208`. Cette génération a été sauvegardée avant la copie. La source
reste inchangée ; la destination reprend le lineage propriétaire. Toutes les
ressources, leurs IDs, attributs et outputs sont strictement identiques à la
source. Les deux validations de variables restent `pass`, avec un ordre de
sérialisation différent. Le champ `terraform_version` passe de 1.17.0 dans la
source à la version exécutante 1.16.6 dans la destination, et le serial de 5 à 6.
Aucune autre différence de contenu n'a été relevée.
Les sauvegardes du 11 novembre ont été relues et leurs SHA256 correspondent.
Les nouveaux snapshots, plans et caches sont sous
`%LOCALAPPDATA%/Codex/secure-state-backups/prod-standardization-20261111-172045/c02-live-20261112/`.
Les ACL du dossier parent et du nouveau dossier autorisent uniquement
l'utilisateur Windows et SYSTEM. Les buckets conservent le versioning activé.
Les fichiers sensibles restent hors Git ; les preuves publiables sont filtrées.

## Gel, exécution et consommateurs

Aucun verrou `.tflock` n'était présent aux relevés. Les recherches Actions par
statut queued, in_progress, waiting, pending et requested retournent zéro run
au contrôle initial et au nouveau contrôle sous gel. Aucun processus Terraform
local n'était présent avant les plans. Ces observations seules ne constituaient
pas un gel : la migration a attendu la confirmation explicite utilisateur/équipe.

L'environnement GitHub `prod` n'a **aucune règle de protection**, aucun reviewer
obligatoire ni restriction de branche. Terraform Deploy peut appliquer les deux
environnements sur un tag de release ; le dispatch permet une ancienne `ref`.
Terraform Destroy reste déclenchable manuellement. Les backends courants sont
canoniques, mais ces mécanismes ne neutralisent pas une ancienne configuration.
Une modification locale de workflow n'empêcherait pas son exécution distante
depuis une ancienne branche ou un tag. Aucune protection distante n'a été changée.

L'utilisateur a ensuite confirmé : « Oui : je confirme mon accord et celui de
l'équipe ; toutes les opérations Terraform PROD sont gelées. » Les dix states,
leurs propriétaires, les ressources GCP, sauvegardes, générations, verrous,
révisions et statuts Actions ont été recontrôlés avant toute copie. Aucun écart
depuis l'audit initial, hors les deux states vides déjà documentés.
Le gel est opérationnel, confirmé par l'utilisateur et l'équipe ; aucune
désactivation technique des workflows ni protection GitHub n'a été installée
par cet agent. L'absence de run actif ne garantit pas à elle seule l'absence
de nouveaux déclenchements. Ne pas lever le gel tant que l'équipe n'a pas
confirmé la bascule de tous ses consommateurs vers foundation/prod.

La [procédure officielle init](https://developer.hashicorp.com/terraform/cli/commands/init)
et le [backend GCS avec verrouillage](https://developer.hashicorp.com/terraform/language/backend/gcs)
restent les références. La dernière commande ci-dessous a été exécutée depuis
la copie privée de la foundation C04 revue, dans le même `TF_DATA_DIR` initialisé
explicitement sur la source historique lors de l'audit :

```sh
# Après contrôle et confirmation du gel seulement.
terraform init -backend-config=backends/prod.hcl -backend-config=prefix=foundation/prd -input=false -lockfile=readonly
terraform workspace show
terraform state list
terraform init -migrate-state -backend-config=backends/prod.hcl -lock=true -lock-timeout=60s -lockfile=readonly
```

Terraform a reconnu la destination comme vide malgré son lineage distinct et
a proposé la copie, sans conflit ni refus. Pendant l'attente interactive, les
verrous `.tflock` des deux préfixes ont été observés et les deux générations
originales revérifiées. La réponse `yes` a été saisie après examen du message.
La commande retourne exit 0. Aucun `-force-copy`, `state push -force`,
`-reconfigure`, suppression de state ou force-unlock n'a été employé.

Après copie, les deux IDs et tous les attributs/outputs ont été comparés, le
lineage/serial vérifié, puis un **nouveau plan sur foundation/prod** a été
exécuté avec C04. Le relevé GCP/GCS final confirme que seule la destination a
changé, avec les neuf autres states et les ressources GCP inchangés, et aucun
verrou résiduel. Aucun state GKE/runners n'a été migré.
Les backends courants de main, C02 et C04 ainsi que les workflows utilisent la
convention canonique ; aucune occurrence opérationnelle de l'ancien nom n'a
été trouvée dans les fichiers backend/tfvars/Terraform/scripts/workflows suivis.
Le cache Terraform principal du dépôt reste sur foundation/dev. Le cache dédié
ayant effectué la migration est sur foundation/prod. Les anciens caches et
procédures d'audit privés ne doivent plus servir à écrire dans la source.
Les postes des autres opérateurs ne sont pas inspectables depuis cette session :
leur bascule repose sur la confirmation et le contrôle de l'équipe avant levée
du gel. Aucun changement d'IAM n'a été effectué pour interdire les anciennes refs.

## Bilan et changements de fichiers

Les ressources DEV et le VPC/subnet PROD ont été préservés. Les imports bootstrap
et tests de destruction déjà réalisés n'ont pas été rejoués. Aucun import,
apply, destroy ou push n'a été exécuté pendant ce contrôle. Seule la migration
de state autorisée après confirmation du gel a été exécutée.

Modifications de cette intervention : le présent rapport, ses preuves JSON,
un lien de fraîcheur dans `MIGRATION-PROD-2026-11-11.md`, et les occurrences dans
`docs/Troubleshoot.md`. Aucun fichier Terraform, backend, workflow ou ancienne
preuve JSON n'a été modifié. Les scripts d'audit temporaires sont dans `.gitnexus`
ignoré ; les données brutes restent privées. Aucun commit créé, aucun push ;
les règles de signature et Signed-off-by restent inchangées.

GitNexus a été rafraîchi à HEAD avant les modifications : impact du rapport de
migration MEDIUM (six documents directement liés, aucun processus), impact du
journal LOW (CONTRIBUTOR puis README, aucun processus). Les nouveaux fichiers
retournent UNKNOWN car absents du graphe ; leur absence et leurs références ont
été contrôlées par recherche complémentaire. L'extension FTS reste indisponible,
donc les recherches conceptuelles vides ne prouvent aucune absence d'impact.
Les contrôles finaux structurés `detect_changes` couvrent les quatre fichiers
de cette intervention (12 symboles), et la comparaison à `origin/main` couvre
36 fichiers (42 symboles). Les deux retournent risque LOW, aucun processus
affecté, `partial=false`, `truncated=false`. Le contrôle des espaces Git, des
liens locaux et des invariants des preuves JSON a également réussi.

**Réalisé :** gel explicitement confirmé, migration foundation canonique et
plan post-migration vérifiés. **Restent à résoudre :** bascule des consommateurs
avant levée du gel, revue des deux créations réseau et des plages PROD, inventaire GKE
PROD accessible, validation des prérequis ARC PROD, correction du Secret dans
le code C04, puis nouveaux plans. La fusion C04 exige également une CI verte.
C02 objectif 2 attend l'examen du plan puis une application ultérieure autorisée.
La cohérence complète DEV/PROD reste incomplète ; les objectifs
1, 3 et 4 gardent leur validation antérieure.
