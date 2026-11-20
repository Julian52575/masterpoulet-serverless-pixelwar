# Existing PROD release; preserve its name and GitHub routing label.
project_id               = "masterpoulet-prod"
zone                     = "europe-west3-b"
cluster_name             = "masterpoulet-prod-gke"
node_pool_name           = "github-runners"
runner_scale_set_name    = "masterpoulet-prod-gke"
controller_chart_version = "0.15.0"
