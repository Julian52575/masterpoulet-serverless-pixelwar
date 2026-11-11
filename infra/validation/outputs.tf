output "network_name" {
  value = google_compute_network.validation.name
}

output "subnet_name" {
  value = google_compute_subnetwork.validation.name
}
