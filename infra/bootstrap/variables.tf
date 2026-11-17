variable "project_id" {
  description = "Target GCP project."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a valid GCP project ID."
  }
}

variable "region" {
  description = "Location of the state bucket."
  type        = string
  default     = "europe-west1"
}

variable "github_repository" {
  description = "GitHub repository allowed to impersonate the deployer, as owner/name."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use owner/name, for example my-org/my-repo."
  }
}

variable "state_bucket_name" {
  description = "Globally unique bucket holding the Terraform state of every other stack."
  type        = string
}

variable "state_bucket_force_destroy" {
  description = "Delete the state bucket with its contents on destroy. Keep true only if the whole project is disposable."
  type        = bool
  default     = true
}

variable "pool_id" {
  description = "Workload Identity Pool id. Deleted ids stay reserved for 30 days."
  type        = string
  default     = "github"
}

variable "provider_id" {
  description = "Workload Identity Pool provider id. Deleted ids stay reserved for 30 days."
  type        = string
  default     = "github-oidc"
}

variable "deployer_account_id" {
  description = "Account id of the service account GitHub Actions impersonates."
  type        = string
  default     = "terraform-deployer"
}
