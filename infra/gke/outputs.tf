output "cluster_name" {
  description = "Name of the zonal Standard cluster."
  value       = google_container_cluster.gke.name
}

output "cluster_location" {
  description = "Single cluster zone."
  value       = google_container_cluster.gke.location
}

output "node_pool_name" {
  description = "Dedicated runner pool."
  value       = google_container_node_pool.runners.name
}

output "node_service_account_email" {
  description = "Dedicated node identity; no private key is created."
  value       = google_service_account.nodes.email
}

output "get_credentials_command" {
  description = "Run manually after deployment with an authorized Google identity."
  value       = "gcloud.cmd container clusters get-credentials ${var.cluster_name} --zone=${var.zone} --project=${var.project_id} --dns-endpoint"
}
