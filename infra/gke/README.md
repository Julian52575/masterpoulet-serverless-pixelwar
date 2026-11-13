# GKE — capacité réservée aux runners

Ce root réutilise le réseau foundation et gère le cluster Standard zonal,
le pool github-runners, le service account des nœuds et son rôle IAM.
Il ne déploie ni application Pixel War, ni ARC, ni réseau supplémentaire.

| Cible | Cluster | Zone | Backend |
| --- | --- | --- | --- |
| DEV | masterpoulet-dev-gke | europe-west1-b | gke/dev |
| PROD | masterpoulet-prod-gke | europe-west3-b | gke/prod |

Les tfvars conservent 1–2 nœuds e2-standard-2, 30 Go pd-standard par nœud,
nœuds privés, réparation/mise à jour automatiques et Workload Identity GKE.
Le control plane utilise un endpoint DNS authentifié par IAM ; les endpoints IP
sont désactivés. Le compte des nœuds a container.defaultNodeServiceAccount.
Les permissions des futurs workloads restent à définir séparément.

Prérequis : APIs accessibles, droits, quotas, facturation et foundation complète
avec les plages Pods/Services distinctes. Les postconditions réseau sont utiles
et conservées. Un HTTP 403 ne signifie pas que le cluster est absent.

PROD reste protégé par deletion_protection=true. Avant une destruction revue,
appliquer explicitement false, puis refaire le plan destroy. Retirer les releases
ARC avant le cluster. Une destruction perd les Secrets et objets Kubernetes ;
préparer leur restauration avant toute démo. Ne pas modifier le state pour
contourner cette protection et ne pas détruire les réseaux partagés.

Commandes et coûts : [guide commun](../README.md).
