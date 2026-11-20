mock_provider "google" {
  mock_data "google_compute_network" {
    defaults = { self_link = "https://www.googleapis.com/compute/v1/projects/test/global/networks/vpc" }
  }
  mock_data "google_compute_subnetwork" {
    defaults = {
      network                  = "https://www.googleapis.com/compute/v1/projects/test/global/networks/vpc"
      private_ip_google_access = true
      secondary_ip_range = [
        { range_name = "masterpoulet-dev-vpc-subnet-pods", ip_cidr_range = "10.16.0.0/21" },
        { range_name = "masterpoulet-dev-vpc-subnet-services", ip_cidr_range = "10.16.8.0/24" },
        { range_name = "masterpoulet-prod-vpc-subnet-pods", ip_cidr_range = "10.32.0.0/21" },
        { range_name = "masterpoulet-prod-vpc-subnet-services", ip_cidr_range = "10.32.8.0/24" }
      ]
    }
  }
}

run "capacity_and_isolation" {
  command = plan

  assert {
    condition = (
      google_container_node_pool.system.node_count == 1 &&
      length(google_container_node_pool.system.autoscaling) == 0 &&
      google_container_node_pool.system.node_config[0].labels.workload == "system"
    )
    error_message = "Permanent system capacity must survive zero worker demand."
  }

  assert {
    condition = (
      google_container_node_pool.runners.autoscaling[0].total_min_node_count == 0 &&
      google_container_node_pool.runners.autoscaling[0].total_max_node_count == 2 &&
      google_container_node_pool.runners.initial_node_count == 0 &&
      google_container_node_pool.runners.node_config[0].labels.workload == "worker" &&
      one(google_container_node_pool.runners.node_config[0].taint).effect == "NO_SCHEDULE"
    )
    error_message = "Workers must start at zero, have a total ceiling of two and reject untolerated pods."
  }

  assert {
    condition     = google_container_cluster.gke.name == var.cluster_name && google_project_service.container.disable_on_destroy == false
    error_message = "Preserve cluster identity and never disable its API on removal."
  }
}
