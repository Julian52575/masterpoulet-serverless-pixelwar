# ARC — controller et listener permanents, runners à la demande

[Guide et coûts](../README.md) · [Migration et rollback](../gke/README.md)

## Configuration du 20 novembre 2026

Charts officiels 0.15.0, providers Helm 3.3.0 et Kubernetes 3.5.0 verrouillés. Controller arc dans
arc-systems, service account arc-controller ; scale set dans arc-runners.
Le Secret **arc-rw**, clé github_token, et les namespaces existants sont
conservés. Terraform référence uniquement le nom du Secret, sans lire sa valeur.

| Cible | Nom réel de release / label GitHub | Backend runners |
| --- | --- | --- |
| DEV | masterpoulet-dev-gke | masterpoulet_bucket, runners/dev |
| PROD | masterpoulet-prod-gke | masterpoulet_prod_bucket, runners/prod |

Les states et Helm confirment ces noms, différents du nom générique historique
masterpoulet-gke-runners. Les tfvars préservent les noms déployés sans remplacer
les releases. Le smoke test manuel cible ces labels ; les autres workflows
restent inchangés et utilisent ubuntu-latest. Les builds courants ne déclenchent
donc pas nécessairement de runner ARC.

| Composant | Placement | CPU request / limit | RAM request / limit |
| --- | --- | --- | --- |
| Controller | workload=system | 50m / 500m | 64Mi / 256Mi |
| Listener | workload=system | 50m / 500m | 64Mi / 256Mi |
| Runner | workload=worker ET pool github-runners | 500m / 1 | 512Mi / 1Gi |

Seul le runner tolère workload=worker:NoSchedule. Les requests ARC deviennent
50m/64Mi par processus sur e2-small ; les maxima historiques mesurés sont
30,43Mi/8,26m pour le controller et 16,19Mi/3,15m pour le listener.
Les limites restent 500m/256Mi et doivent être vérifiées sous deux vrais jobs.
Le runner conserve son image
ghcr.io/actions/actions-runner:2.338.2 et son stockage éphémère 1Gi/2Gi.
Aucun sidecar Docker, mode dind, volume ou privilège n'est ajouté.
Les jobs exigeant Docker ou plus de RAM nécessitent une adaptation séparée.

minRunners=0, maxRunners=2. GitHub → listener permanent → runner Pending →
Cluster Autoscaler → worker → job → suppression du runner → retrait du worker
inutile. L'autoscaler réagit aux requests et contraintes de scheduling.
Deux runners de 500m peuvent tenir sur **un seul** e2-standard-2 : deux jobs
ne garantissent pas deux nœuds. Le deuxième nœud démarre si la capacité l'exige.

Les plans DEV/PROD donnent chacun 1 adoption de données DNS, 2 mises à jour
Helm en place, 0 suppression. DEV rétablit aussi atomic=true du controller.
La nouvelle ressource kubernetes_config_map_v1_data ne crée pas de ConfigMap :
elle prend en charge uniquement sa clé linear et conserve les autres données.
Le ConfigMap doit préexister. Son champ min/max=1 évite une deuxième réplique
DNS sur l'unique système lors du réveil des workers. Le DNS reste actif.
force=true transfère seulement cette clé depuis le gestionnaire GKE ;
prevent_destroy interdit son retrait accidentel. Le controller dépend de
ce réglage. Voir le [budget et la migration](../gke/README.md).
Les tests Terraform mockés couvrent les deux tfvars. Le lint/rendu des charts
vérifie les valeurs des plans ; cela ne prouve pas un scale-to-zero réel.
Un kubeconfig alternatif doit être passé via -var=kubeconfig_path=<chemin> :
KUBECONFIG seul ne remplace pas le config_path explicite du provider.

## Recette après déploiement

À exécuter après approbation/migration DEV, puis en PROD après validation de
sa sortie réseau. Aucun workflow n'a été déclenché pendant l'implémentation.
Reprendre les variables du guide GKE et relever les horaires : job soumis,
pod Pending, node Ready, début/fin du job, disparition du runner et du worker.

~~~powershell
kubectl "--context=$kubeContext" get nodes -L workload,cloud.google.com/gke-nodepool
kubectl "--context=$kubeContext" get pods -A -o wide
kubectl "--context=$kubeContext" -n arc-runners get autoscalingrunnersets,ephemeralrunnersets,ephemeralrunners
kubectl "--context=$kubeContext" get pdb -A
kubectl "--context=$kubeContext" -n kube-system get deployment kube-dns
kubectl "--context=$kubeContext" -n kube-system get configmap kube-dns-autoscaler -o yaml
kubectl "--context=$kubeContext" top nodes
kubectl "--context=$kubeContext" top pods -A
gcloud.cmd container node-pools describe github-runners "--cluster=$gkeCluster" "--zone=$gkeZone" "--project=$gcpProject" '--format=yaml(autoscaling,config.labels,config.taints,instanceGroupUrls)'
~~~

Le [smoke test manuel](../../.github/workflows/arc-smoke-test.yml) propose
DEV/PROD et parallel=true pour deux jobs, maintenus 30 secondes pour observer
la concurrence. Son délai d'exécution est 15 minutes ; surveiller séparément
l'attente en file. Le push de cette branche ne le déclenche pas.
Après autorisation des tests :

~~~powershell
gh workflow run arc-smoke-test.yml --ref feat/terraform-gke-node-pools-optimization -f runner=masterpoulet-dev-gke -f parallel=false
gh run list --workflow=arc-smoke-test.yml --branch=feat/terraform-gke-node-pools-optimization --limit=5
gh run watch <run-id> --exit-status
gh workflow run arc-smoke-test.yml --ref feat/terraform-gke-node-pools-optimization -f runner=masterpoulet-dev-gke -f parallel=true
~~~

Lire le run-id dans la liste, attendre son succès, puis poursuivre.
Pour PROD, remplacer runner par masterpoulet-prod-gke après validation DEV/réseau.

| Scénario | Critère de réussite |
| --- | --- |
| Aucun job | 1 system Ready, 0 worker/runner ; controller et listener sur system |
| Un job depuis zéro | runner Pending, worker créé, runner sur github-runners, succès GitHub |
| Deux jobs | deux runners isolés sur workers, deux succès, un ou deux nœuds selon capacité |
| Besoin d'un deuxième worker | création du deuxième, jamais plus de deux au total |
| Fin des jobs | suppression des runners et ephemeralRunnerSets |
| Pool inutilisé | retour à zéro, ARC reste disponible |
| Nouveau job après zéro | répéter le test simple avec succès |
| Plusieurs heures sans jobs | aucun worker/boot disk worker dans Compute Engine ; coût système persistant |

Ajouter à la recette : DNS reste à une réplique Ready avec 0, 1 et 2 workers ;
les drivers CSI et NodeLocal DNS n'ont plus de pod ; Allocatable couvre les
requests effectives et le surge DNS de 115Mi/110m ; rollout du controller,
redémarrage listener et retour à zéro réussissent sans OOM, éviction ou pression.
Ne pas lancer simultanément plusieurs rollouts sur le nœud système minimal.
Les redémarrages/tests modifiant les pods attendent l'approbation du déploiement.

Pour vérifier le deuxième nœud indépendamment des runners, utiliser après
autorisation ce Job temporaire. Deux pods de 1100m dépassent les 1930m
allocatables d'un e2-standard-2. Enregistrer hors Git, appliquer avec un
contexte explicite, attendre sa fin puis supprimer le Job sur la même cible.
Ce test ne remplace pas les deux vrais jobs GitHub.

~~~yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: worker-capacity-check
  namespace: arc-runners
spec:
  parallelism: 2
  completions: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 120
  template:
    spec:
      restartPolicy: Never
      nodeSelector:
        workload: worker
        cloud.google.com/gke-nodepool: github-runners
      tolerations:
        - key: workload
          operator: Equal
          value: worker
          effect: NoSchedule
      containers:
        - name: capacity
          image: busybox:1.37.0
          command: [sh, -c, 'sleep 120']
          resources:
            requests: {cpu: 1100m, memory: 128Mi}
            limits: {cpu: 1100m, memory: 128Mi}
~~~

Le retour à zéro n'est pas instantané : GKE décide du délai et les pods
kube-system récents peuvent retarder la descente d'au moins une heure.
Si elle bloque, lire Pending/events, PDB, volumes locaux, safe-to-evict,
requests, taints/tolerations, quotas/stock GCE et les logs
container.googleapis.com/cluster-autoscaler-visibility. Ne pas supprimer
les agents ni généraliser safe-to-evict=true pour masquer le problème.

Sources : [scale sets GitHub](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/deploy-runner-scale-sets),
[autoscaler GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cluster-autoscaler),
[diagnostic scale-down](https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting/cluster-autoscaler-scale-down).

## Historique et sécurité

Le 30 octobre, un 403 GitHub dû au PAT avait bloqué le premier scale set DEV.
Après correction externe, le
[smoke test historique](https://github.com/Julian52575/masterpoulet-serverless-pixelwar/actions/runs/41059039569)
avait réussi. Cela ne prouve pas le fonctionnement des pools proposés ici.
Ne pas copier le PAT dans Git, tfvars, values, logs ou plans publiés.
Restaurer un Secret perdu depuis sa source sécurisée, hors Terraform.
Ne pas supprimer des CRD ARC encore utilisées par une autre release.
