# ARC — controller et runner scale set

Deux releases Helm officielles, version 0.15.0 et provider verrouillé :

| Release | Namespace | Chart |
| --- | --- | --- |
| arc | arc-systems | gha-runner-scale-set-controller |
| masterpoulet-gke-runners | arc-runners | gha-runner-scale-set |

Le scale set dépend du contrôleur ; Terraform respecte cet ordre à la création
et l’inverse à la suppression. Le placement vise le pool github-runners.
minRunners=0, maxRunners=2. Le contrôleur et le listener consomment des ressources
même sans job. L’autoscaler des nœuds réagit aux Pods Pending, pas à GitHub directement.

Les backends sont runners/dev et runners/prod, dans les buckets respectifs.
Helm impose gke_<projet>_<zone>_<cluster> dans le kubeconfig local ; le contexte
courant du terminal ne doit jamais servir à choisir implicitement DEV/PROD.

Prérequis externes : cluster joignable, namespace arc-runners et Secret
github-pat-arc contenant github_token, préparés manuellement sans copier la
valeur dans Terraform. La référence conservée correspond à l’installation DEV ;
aucune rotation de token n’est effectuée. Ces objets disparaissent avec GKE et
nécessitent une source de restauration hors cluster. Aucun gestionnaire de
secrets ou credential GitHub n’est créé ici.

Le [smoke test](../../.github/workflows/arc-smoke-test.yml) utilise le label
masterpoulet-gke-runners, déclaré dans actionlint. Ne pas le lancer pour un simple
contrôle statique. Une release deployed ne garantit pas l’exécution d’un job.
Une seconde installation PROD pour le même dépôt doit être justifiée avant
déploiement ; elle n’est pas nécessaire pour valider une CI partagée en DEV.

Procédure Terraform : [guide commun](../README.md).
