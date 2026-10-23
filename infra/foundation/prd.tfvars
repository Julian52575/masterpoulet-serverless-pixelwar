project_id   = "masterpoulet-prod"
region       = "europe-west3"
network_name = "masterpoulet-prod-vpc"
subnet_name  = "masterpoulet-prod-vpc-subnet"
subnet_cidr  = "10.0.2.0/24"

gke_pods_cidr     = "10.32.0.0/21"
gke_services_cidr = "10.32.8.0/24"
