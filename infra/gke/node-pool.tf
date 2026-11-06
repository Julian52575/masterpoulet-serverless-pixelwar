resource "google_container_node_pool" "runners" {
  project            = var.project_id
  name               = var.node_pool_name
  location           = var.zone
  node_locations     = [var.zone]
  cluster            = google_container_cluster.gke.name
  initial_node_count = var.node_autoscaling.min
  max_pods_per_node  = 32

  autoscaling {
    min_node_count = var.node_autoscaling.min
    max_node_count = var.node_autoscaling.max
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  # Demo budget: replace one node at a time without extra upgrade nodes.
  upgrade_settings {
    max_surge       = 0
    max_unavailable = 1
  }

  network_config {
    enable_private_nodes = true
  }

  node_config {
    machine_type    = var.machine_type
    disk_size_gb    = var.disk_size_gb
    disk_type       = var.disk_type
    image_type      = "COS_CONTAINERD"
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    labels = {
      workload = "github-runners"
    }

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  lifecycle {
    ignore_changes = [initial_node_count]
  }
}
