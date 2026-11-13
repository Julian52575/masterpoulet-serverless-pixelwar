output "secret_names" {
  description = "Container resource names only; no secret value/version is read."
  value       = { for id, secret in google_secret_manager_secret.discord : id => secret.name }
}
