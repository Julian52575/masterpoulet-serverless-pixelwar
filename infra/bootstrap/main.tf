locals {
  targets = {
    dev = {
      project_id  = "masterpoulet-dev"
      bucket_name = "masterpoulet_bucket"
    }
    prod = {
      project_id  = "masterpoulet-prod"
      bucket_name = "masterpoulet_prod_bucket"
    }
  }
  target = local.targets[var.environment]
}

resource "google_storage_bucket" "terraform_state" {
  project                     = local.target.project_id
  name                        = local.target.bucket_name
  location                    = "EUROPE-WEST1"
  storage_class               = "STANDARD"
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  encryption {
    google_managed_encryption_enforcement_config {
      restriction_mode = "NotRestricted"
    }
    customer_managed_encryption_enforcement_config {
      restriction_mode = "NotRestricted"
    }
    customer_supplied_encryption_enforcement_config {
      restriction_mode = "FullyRestricted"
    }
  }

  # Preserve the existing rules for noncurrent object versions.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      with_state         = "ARCHIVED"
      num_newer_versions = 5
      send_age_if_zero   = false
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      days_since_noncurrent_time = 30
      send_age_if_zero           = false
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
