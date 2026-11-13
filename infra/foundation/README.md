# Foundation — réseaux DEV et PROD

Ce root gère un VPC custom, un subnet avec plages secondaires GKE, un Router
et le NAT optionnel. Il ne gère ni bucket, ni IAM, ni API, ni cluster, ni runner.
Les réseaux default GCP restent hors de ce state.

| Valeur | DEV | PROD |
| --- | --- | --- |
| Région | europe-west1 | europe-west3 |
| VPC | masterpoulet-dev-vpc | masterpoulet-prod-vpc |
| Subnet primaire | 10.0.1.0/24 | 10.0.2.0/24 |
| Pods | 10.16.0.0/21 | 10.32.0.0/21 |
| Services | 10.16.8.0/24 | 10.32.8.0/24 |
| Backend | foundation/dev | foundation/prod |

Private Google Access est conservé. NAT couvre les plages primaires et
secondaires du seul subnet sélectionné, avec allocation automatique d’IP.
enable_nat=true par défaut. Le désactiver supprime uniquement le NAT ; garder
le bloc moved de google_compute_router_nat.nat vers nat[0] pour les anciens states.
GKE lit le VPC/subnet par data sources, sans terraform_remote_state.

Ne pas retirer de plage secondaire utilisée par GKE, remplacer le VPC/subnet
ou détruire ce root pour arrêter les runners. Les noms et adresses existants
sont préservés. La [migration PROD a été effectuée](MIGRATION-PROD-2026-11-11.md),
mais la bascule de tous les opérateurs n’est pas confirmée : ne pas écrire
depuis l’ancien backend et ne pas supprimer son state.

Commandes standard : [guide commun](../README.md).
