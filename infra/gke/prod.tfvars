# Prepared example only: PROD capacity and zone require a separate review.
project_id              = "masterpoulet-prod"
region                  = "europe-west3"
zone                    = "europe-west3-b"
cluster_name            = "masterpoulet-prod-gke"
network_name            = "masterpoulet-prod-vpc"
subnet_name             = "masterpoulet-prod-vpc-subnet"
pods_range_name         = "masterpoulet-prod-vpc-subnet-pods"
services_range_name     = "masterpoulet-prod-vpc-subnet-services"
node_service_account_id = "masterpoulet-prod-gke-nodes"
node_pool_name          = "github-runners"
machine_type            = "e2-standard-2"
disk_size_gb            = 30
disk_type               = "pd-standard"
node_autoscaling        = { min = 1, max = 2 }
deletion_protection     = true
