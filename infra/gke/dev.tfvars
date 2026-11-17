project_id              = "masterpoulet-dev"
region                  = "europe-west1"
zone                    = "europe-west1-b"
cluster_name            = "masterpoulet-dev-gke"
network_name            = "masterpoulet-dev-vpc"
subnet_name             = "masterpoulet-dev-vpc-subnet"
pods_range_name         = "masterpoulet-dev-vpc-subnet-pods"
services_range_name     = "masterpoulet-dev-vpc-subnet-services"
node_service_account_id = "masterpoulet-dev-gke-nodes"
node_pool_name          = "github-runners"
machine_type            = "e2-standard-2"
disk_size_gb            = 30
disk_type               = "pd-standard"
node_autoscaling        = { min = 1, max = 2 }
deletion_protection     = false
