output "gateway_host" {
  description = "Host to put in the Discord portal and in OAUTH_REDIRECT_URI."
  value       = google_api_gateway_gateway.gateway.default_hostname
}

output "snapshot_bucket" {
  value = google_storage_bucket.snapshots.name
}

output "firebase_web_app_id" {
  value = google_firebase_web_app.site.app_id
}
