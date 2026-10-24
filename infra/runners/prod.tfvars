# Prepared values only. No PROD connection, init, plan or deployment in this step.
project_id               = "masterpoulet-prod"
zone                     = "europe-west3-b"
cluster_name             = "masterpoulet-prod-gke"
node_pool_name           = "github-runners"
controller_chart_version = "0.15.0"
