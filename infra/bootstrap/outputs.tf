output "wif_provider" {
  description = "Value of the WIF_PROVIDER GitHub variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_sa" {
  description = "Value of the DEPLOYER_SA GitHub variable."
  value       = google_service_account.deployer.email
}

output "state_bucket" {
  description = "Bucket to use in the other stacks' backends/*.hcl."
  value       = google_storage_bucket.state.name
}

output "github_variable_commands" {
  description = "Run these to point the workflows at this project."
  value       = <<-EOT
    gh variable set WIF_PROVIDER --body '${google_iam_workload_identity_pool_provider.github.name}'
    gh variable set DEPLOYER_SA  --body '${google_service_account.deployer.email}'
  EOT
}
