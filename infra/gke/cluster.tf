resource "google_container_cluster" "gke" {
  project                  = var.project_id
  name                     = var.cluster_name
  location                 = var.zone
  deletion_protection      = var.deletion_protection
  network                  = data.google_compute_network.vpc.self_link
  subnetwork               = data.google_compute_subnetwork.subnet.self_link
  networking_mode          = "VPC_NATIVE"
  remove_default_node_pool = true
  initial_node_count       = 1
  enable_shielded_nodes    = true
  datapath_provider        = "ADVANCED_DATAPATH"

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  private_cluster_config {
    enable_private_nodes = true
  }

  # IAM-authenticated DNS access avoids exposing a public control-plane IP.
  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic    = true
      enable_k8s_tokens_via_dns = false
      enable_k8s_certs_via_dns  = false
    }
    ip_endpoints_config {
      enabled = false
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }

  addons_config {
    http_load_balancing {
      disabled = true
    }
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = false
    }
  }

  # GKE briefly creates a default pool before removing it. Keep it small and private.
  node_config {
    machine_type    = var.machine_type
    disk_size_gb    = var.disk_size_gb
    disk_type       = var.disk_type
    image_type      = "COS_CONTAINERD"
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

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
      condition     = can(regex("^${var.region}-[a-z]$", var.zone))
      error_message = "The zonal cluster must be in the subnet's region."
    }
  }

  depends_on = [google_project_iam_member.nodes]
}
