# Validations conservées C02 / C04

Résumé des contrôles, sans dumps de state ni preuves JSON répétitives.
Les détails supprimés restent consultables dans l’historique Git : fbd78d5
(C02/PROD) et 1ae9c75 (C04). Le merge 94ff798 conserve les deux historiques.

| Date | Contrôle effectué | Résultat et limites |
| --- | --- | --- |
| 11 novembre | Adoption des buckets existants, via bootstrap/dev et bootstrap/prod | Un propriétaire par bucket ; aucune recréation |
| 11 novembre | Deux cycles de création/destruction d’un VPC/subnet C02 isolé | Reproductibilité vérifiée ; les IDs changent à la recréation ; pas un test GKE/ARC |
| 12 novembre | Migration officielle du state foundation PROD après gel confirmé | Lineage conservé, serial 5→6 ; archive historique intacte |
| 13 novembre, avant nettoyage | Foundation PROD complétée | Deux créations Router/NAT et ajout des plages secondaires en place ; aucun remplacement VPC/subnet |
| 13 novembre, avant nettoyage | Plans DEV bootstrap/foundation/GKE/runners et PROD bootstrap/foundation | Zéro changement physique ; résultats historiques, pas des plans exécutés pendant ce nettoyage |
| C04 | Smoke test ARC exécuté sur GKE DEV | Run 41059039569 réussi ; aucune nouvelle exécution pendant ce nettoyage |

Preuve essentielle du test temporaire :
gs://masterpoulet_bucket/validation/c02/20261111-150221-3a89/default.tfstate,
lineage c2f0172b-62a1-2d24-f163-75193e6774e4, serial 9, sans ressource gérée.
La lecture du 13 novembre confirme ce state vide et aucune entrée GCP portant
le préfixe c02-validation dans les listes de réseaux/subnets DEV. Le module de
test a été retiré du code ; aucune commande destroy ni suppression GCS n’a été lancée.

Les states bootstrap sont au serial 2 : masterpoulet_bucket appartient à
bootstrap/dev et masterpoulet_prod_bucket à bootstrap/prod, chacun dans son bucket.
La lecture des dix states accessibles ne trouve aucun autre propriétaire de ces
buckets ; elle n’exclut pas un state extérieur inaccessible.

PROD GKE/ARC n’ont pas été déployés lors des interventions précédentes.
Leurs states sont vides ; un échec d’inventaire sur API GKE désactivée ne prouve
pas une absence réelle du cluster. La bascule des opérateurs PROD reste à
confirmer : voir [l’historique de migration](MIGRATION-PROD-2026-11-11.md).
Le Secret ARC doit pouvoir être restauré hors cluster avant toute destruction GKE.

La CI vérifie désormais les quatre roots sans backend ni cloud credentials.
Ce contrôle statique ne certifie ni le drift, ni la reconstruction complète
GKE/ARC, ni les budgets, ni les droits WIF. L’application serverless C05–C08,
les déploiements applicatifs et leur conformité finale restent à démontrer.

Nettoyage C02/C04 : fmt, init -backend=false et validate réussissent pour chacun
des quatre roots ; YAML des workflows et liens locaux vérifiés. Les fichiers
Terraform permanents sont identiques au merge signé, et les fichiers applicatifs
sont inchangés. Aucun plan distant, apply, destroy, import ou migration exécuté.
L’audit backend échoue au seuil CI ; les commits restent locaux jusqu’à résolution
de ce [blocage de publication](../../docs/Troubleshoot.md#audit-des-dépendances).
