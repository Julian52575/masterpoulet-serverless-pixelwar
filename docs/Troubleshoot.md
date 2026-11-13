# Troubleshoot

Incidents utiles à l’équipe. Règles : [CONTRIBUTOR](../CONTRIBUTOR.md#troubleshooting).

## Router/NAT supprimés par une ancienne configuration

Le 23 octobre 2026, un ancien workflow a appliqué une révision sans router.tf et
nat.tf contre le state partagé. Terraform a supprimé ces ressources encore
nécessaires. Utiliser la configuration complète et lire le plan ; ne jamais
appliquer une ancienne ref sur un state récent. Les workflows actuels n’appliquent
plus automatiquement. Conserver le réseau pendant l’arrêt des runners.

## PROD propose de recréer le VPC/subnet existant

Cause historique : foundation/prod était vide tandis que foundation/prd portait
les ressources. Modifier le préfixe dans un fichier ne migre pas le state.
La migration officielle du 12 novembre est confirmée ; la bascule de tous les
opérateurs ne l’est pas. Ne pas importer en double, relancer la migration ou
supprimer l’archive. Voir le [statut et les sauvegardes](../infra/foundation/MIGRATION-PROD-2026-11-11.md).

## Import WIF propose de remplacer le pool existant

Le 13 novembre 2026, les premiers plans identity DEV/PROD ont été refusés par
prevent_destroy. L’import WIF normalise project en numéro alors que le code
utilisait l’ID textuel : Terraform proposait un remplacement. Employer le numéro
issu de data.google_project.current pour le pool et le provider, avec leurs IDs
d’import projects/<number>/locations/global/..., sans ignore_changes ni retrait
de protection. Les plans corrigés réussissent : 5 imports, 2 créations, 1 mise
à jour du provider et aucun remplacement par projet. Les plans ont interrogé
GCP avec un backend local privé, car init GCS créerait les states absents.
Voir [les résultats et limites C03](../infra/C03.md#vérifications-et-limites).

## ARC référence un Secret absent ou refuse l’enregistrement

Le code C04 référençait arc-rw alors que DEV utilisait github-pat-arc. La référence
a été alignée sur le Secret existant sans lire sa valeur. Le namespace arc-runners
et le Secret (clé github_token) doivent préexister. Après destruction du cluster,
les restaurer manuellement hors Git. Une réponse GitHub 403 exige de contrôler
la validité du credential et ses droits sur le dépôt ; deployed ne prouve pas
qu’un runner peut exécuter un job. Aucun token dans Terraform/Helm.

## Label ARC inconnu pour actionlint

Le smoke test utilise masterpoulet-gke-runners. Déclarer ce label dans
.github/actionlint.yaml, sans désactiver le contrôle ni remplacer le runner.

## Prisma.sql manque après npm ci

Les scripts d’installation avaient été ignorés, donc Prisma Client n’était pas
généré. Dans backend, exécuter npm exec -- prisma generate puis les tests.
Cette génération n’exige ni migration ni connexion à la base.

## Tests locaux bloqués par le sandbox Windows

Vite/esbuild peut échouer avec spawn EPERM, et des dossiers temporaires peuvent
être inaccessibles. Relancer le contrôle concerné avec les droits d’exécution
nécessaires ; ne pas modifier le code applicatif ni affaiblir la CI pour cela.

## Audit des dépendances

L’audit backend a historiquement bloqué sur deepmerge/Jest, puis sur d’autres
dépendances. Exécuter npm audit sur le lockfile courant pour connaître le statut
actuel. Ne pas faire de downgrade forcé, masquer l’alerte ou baisser le seuil CI
pour un nettoyage d’infrastructure. Un audit échoué doit rester signalé.

Contrôle du 13 novembre 2026 : frontend, zéro entrée ; backend, 16 entrées
modérées et 3 faibles (chaîne Jest, glob/minimatch et deepmerge). Le seuil CI
interdit cinq entrées modérées/faibles ou plus. Les lockfiles applicatifs sont
inchangés par l’intégration/nettoyage ; ce blocage empêchait alors le push C02/C04.
Les remédiations proposées, dont un downgrade majeur de Jest, restent à revoir
séparément. Aucune correction automatique ni modification du seuil n’a été faite.
La mission suivante autorise la publication de la branche C03 si ses contrôles
Terraform et de sécurité passent ; les alertes applicatives préexistantes ne
sont ni corrigées ni présentées comme introduites par C03. La CI conserve ses
propres contrôles et peut bloquer une future intégration.

## Historique Git C04

Le rebase du 11 novembre avait retiré l’historique C02 dupliqué et remplacé les
commits non signés, avec sauvegardes. L’intégration suivante dans C02 utilise un
vrai merge signé (94ff798), sans réécrire C04 ni main. Les anciens diagnostics
restent dans l’historique Git ; ils ne décrivent pas forcément l’état courant.
