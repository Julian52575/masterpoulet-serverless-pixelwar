output "bucket_name" {
  description = "Existing bucket managed by this environment's bootstrap state."
  value       = google_storage_bucket.terraform_state.name
}
