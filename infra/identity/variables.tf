variable "environment" {
  type        = string
  description = "Select the existing project-specific federation, never a shared DEV/PROD identity."
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Use dev or prod."
  }
}

variable "trusted_refs" {
  type        = set(string)
  description = "Exact Git refs authorized for the existing Terraform workflow; no wildcards."
  default     = ["refs/heads/main"]
  validation {
    condition     = length(var.trusted_refs) > 0 && alltrue([for ref in var.trusted_refs : can(regex("^refs/(heads|tags)/[A-Za-z0-9_./-]+$", ref))])
    error_message = "Use explicit refs/heads/... or refs/tags/... values."
  }
}
