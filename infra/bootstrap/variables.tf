variable "environment" {
  description = "Existing state bucket to adopt; always pair with the matching backend."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Select dev or prod."
  }
}
