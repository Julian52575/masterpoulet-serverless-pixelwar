output "hosting_url" {
  description = "Default Firebase Hosting URL; use it as the APP_URL variable."
  value       = "https://${var.project_id}.web.app"
}
