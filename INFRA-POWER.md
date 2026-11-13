# GCP ON / OFF

Depuis la racine, avec Terraform, gcloud/ADC, kubectl et gke-gcloud-auth-plugin :

```sh
python deploy.py
python destroy.py
python deploy.py --env dev --plan-only
python destroy.py --env both --plan-only
```

Le menu propose DEV / PROD / DEV + PROD / Annuler. `--env dev|prod|both`
permet de le sauter. `--plan-only` ne lance aucun apply, m?me pour la d?protection.

- ON : foundation (`enable_nat=true`) ? GKE ? runners.
- OFF : runners ? d?protection du cluster existant ? GKE ? foundation (`enable_nat=false`).

Chaque ?tape fait init puis plan. Sans plan-only, le plan enregistr? est appliqu?.
Les suppressions utilisent `plan -destroy` puis `apply` du m?me plan. Une seule
confirmation `OUI` autorise l'extinction des environnements s?lectionn?s.
Terraform g?re les ressources, le state et les verrous ; Python ne filtre pas ses
plans. Relire la sortie Terraform. Une erreur arr?te imm?diatement la s?quence.

VPC, subnet, Router et buckets sont conserv?s : aucun destroy foundation/bootstrap.
Le NAT conserve son identit? gr?ce au bloc moved. GKE exige une application
pr?alable de `deletion_protection=false` : le script utilise une cible Terraform
sur le cluster, uniquement s'il figure dans le state, puis pr?pare sa destruction.

Les caches sont s?par?s par environnement/stack dans `.terraform-power/`, ignor?
par Git. Les backends sont `backends/dev.hcl` / `backends/prod.hcl`, avec les tfvars
correspondants ; aucune migration automatique. Lancer depuis un environnement
sans TF_VAR_* ou TF_CLI_ARGS* qui modifieraient les commandes choisies.

Avant ARC, deploy.py actualise le kubeconfig local et v?rifie le nom du Secret
`arc-runners/github-pat-arc` dans le contexte GKE explicite. Si n?cessaire,
configurer manuellement le namespace et ce Secret (cl? `github_token`), hors Git,
puis relancer. Aucun gestionnaire de secrets n'est install?. La destruction du
cluster perd ce Secret : pr?voir sa restauration avant OFF. En plan-only, un
cluster absent ne permet pas de v?rifier ARC. NAT/GKE peuvent rester facturables
si le d?ploiement s'arr?te ? cette ?tape.

Les workflows locaux restent sans apply automatique ; les anciennes versions
publi?es doivent ?tre neutralis?es par l'?quipe avant OFF. PROD n?cessite une
API GKE accessible et un budget adapt? ; le budget pr?c?dent ?tait 20 USD/mois.
OFF ne supprime pas C05?C08 ni les ressources hors de ces stacks et ne garantit
pas une facture nulle. Les scripts n'effectuent aucun rollback automatique.

Tests sans appels cloud : `python -m unittest discover -s tests`.
