output "gateway_host" {
  description = "Host to put in the Discord portal; OAUTH_REDIRECT_URI is derived from it."
  value       = google_api_gateway_gateway.gateway.default_hostname
}

output "snapshot_bucket" {
  value = google_storage_bucket.snapshots.name
}

output "firebase_web_app_id" {
  value = google_firebase_web_app.site.app_id
}

output "firebase_web_api_key" {
  description = "Web apiKey for the frontend build; it only identifies the project, it is not a secret."
  value       = data.google_firebase_web_app_config.site.api_key
}

output "api_base_url" {
  description = "VITE_API_BASE for the frontend build."
  value       = "https://${google_api_gateway_gateway.gateway.default_hostname}"
}

output "app_url" {
  value = local.app_url
}
