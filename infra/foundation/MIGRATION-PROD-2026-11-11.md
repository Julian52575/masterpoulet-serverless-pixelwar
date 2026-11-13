# State foundation PROD — historique et consignes

**Migration effectuée le 12 novembre 2026. Bascule de tous les opérateurs non confirmée.**
Le 11 novembre, elle était seulement préparée, en attente du gel de l’équipe.
Après confirmation du gel le 12 novembre, init -migrate-state a copié le state
via la procédure officielle Terraform. Aucun forçage, state push/rm ou effacement
de la source. Ne pas relancer cette migration.

## État confirmé en lecture seule le 13 novembre 2026

| Propriété | Archive historique | Backend canonique |
| --- | --- | --- |
| Bucket | masterpoulet_prod_bucket | masterpoulet_prod_bucket |
| Préfixe | foundation/prd | foundation/prod |
| Génération GCS | 1792763537877160 | 1794570786235431 |
| Serial | 5 | 8 |
| Ressources | VPC, subnet | VPC, subnet, Router, NAT |

Le lineage commun est 7e009275-d640-4fa0-8a3a-e5d7656547e0. La copie initiale
canonique avait le serial 6 ; la foundation a ensuite été complétée le 13 novembre.
Les IDs VPC/subnet restent projects/masterpoulet-prod/global/networks/masterpoulet-prod-vpc
et projects/masterpoulet-prod/regions/europe-west3/subnetworks/masterpoulet-prod-vpc-subnet.
backends/prod.hcl référence bien foundation/prod. Le nom prd n’est qu’un chemin
d’archive, jamais une cible opérationnelle.

## Avant toute nouvelle écriture PROD

Confirmer que tous les opérateurs, caches et pipelines ont abandonné l’ancien
backend. L’absence de verrou n’est pas une confirmation du gel. L’archive reste
intacte ; sa suppression et la levée du gel exigent une décision explicite de
l’équipe. Ne pas importer les mêmes ressources dans un autre state.

Les copies de sauvegarde et backup-manifest.json sont hors Git, sous
%LOCALAPPDATA%/Codex/secure-state-backups/prod-standardization-20261111-172045/.
La source sauvegardée est foundation-source-archive.tfstate ; l’ancienne
destination vide est foundation-destination-before-empty.tfstate (génération
1793714422833208, ancien lineage 8176c273-dfb3-c80e-efc1-ed1031e16915).
Les sauvegardes avaient été vérifiées par taille, MD5 et SHA256 ; vérifier de
nouveau leur intégrité, ACL et générations avant toute restauration.

Pour une future migration différente : gel explicite de tous les écrivains,
inventaire des propriétaires et dépendances, sauvegardes des deux states avec
générations/checksums, contrôle des pipelines/verrous, puis uniquement la
procédure officielle init -migrate-state. Refuser une destination inattendue ou
modifiée ; aucun -force-copy, state push -force, suppression ou force-unlock.
Après migration, comparer lineage, IDs/attributs et plan avant de lever le gel.
Ce paragraphe conserve la procédure ; il n’autorise aucune opération maintenant.

Un retour direct à l’archive serial 5 omettrait Router/NAT et les plages ajoutées
depuis : ce n’est pas un rollback sûr. En cas d’incident, geler les écrivains,
comparer les générations versionnées et faire revoir une restauration compatible
avec les ressources actuelles, sans écraser un state courant inconnu.
