output "workload_identity_provider" {
  description = "Existing WIF_PROVIDER identifier; no GitHub variable is changed."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Existing DEPLOYER_SA email; no permanent key is created."
  value       = google_service_account.deployer.email
}
