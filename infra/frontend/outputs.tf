output "bucket_name" {
  description = "Name of the Cloud Storage bucket holding static frontend assets"
  value       = google_storage_bucket.frontend.name
}

output "bucket_url" {
  description = "GCS URL of the frontend bucket"
  value       = "gs://${google_storage_bucket.frontend.name}"
}

output "load_balancer_ip" {
  description = "Public IP address of the frontend external HTTP load balancer"
  value       = google_compute_global_forwarding_rule.frontend.ip_address
}
