resource "google_container_node_pool" "runners" {
  project            = var.project_id
  name               = var.node_pool_name
  location           = var.zone
  node_locations     = [var.zone]
  cluster            = google_container_cluster.gke.name
  initial_node_count = var.node_autoscaling.min
  max_pods_per_node  = 32

  autoscaling {
    total_min_node_count = var.node_autoscaling.min
    total_max_node_count = var.node_autoscaling.max
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
    labels          = var.worker_node_labels

    dynamic "taint" {
      for_each = var.worker_node_taints
      content {
        key    = taint.value.key
        value  = taint.value.value
        effect = taint.value.effect
      }
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

resource "google_container_node_pool" "system" {
  project           = var.project_id
  name              = var.system_node_pool_name
  location          = var.zone
  node_locations    = [var.zone]
  cluster           = google_container_cluster.gke.name
  node_count        = var.system_node_count
  max_pods_per_node = 32

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  # A single permanent node is economical, but upgrades interrupt ARC briefly.
  upgrade_settings {
    max_surge       = 0
    max_unavailable = 1
  }

  network_config {
    enable_private_nodes = true
  }

  node_config {
    machine_type    = var.system_machine_type
    disk_size_gb    = var.system_disk_size_gb
    disk_type       = var.disk_type
    image_type      = "COS_CONTAINERD"
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    labels          = var.system_node_labels

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  lifecycle {
    precondition {
      condition     = var.system_node_pool_name != var.node_pool_name
      error_message = "System and worker pools must have distinct names."
    }
  }
}
