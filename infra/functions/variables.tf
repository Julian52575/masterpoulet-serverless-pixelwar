variable "project_id" {
  description = "Target GCP project, selected by the environment tfvars file."
  type        = string
}

variable "region" {
  description = "Region of the functions, the snapshot bucket and the scheduler."
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Firestore location; cannot be changed once the database exists."
  type        = string
  default     = "eur3"
}

variable "discord_client_id" {
  description = "Discord application id."
  type        = string

  validation {
    condition     = length(var.discord_client_id) > 0
    error_message = "Set the DISCORD_CLIENT_ID GitHub variable (TF_VAR_discord_client_id)."
  }
}

variable "oauth_redirect_uri" {
  description = "Public https://<host>/api/auth/callback. Set by variable because the gateway host depends on the functions (cycle)."
  type        = string

  validation {
    condition     = startswith(var.oauth_redirect_uri, "https://")
    error_message = "Set the OAUTH_REDIRECT_URI GitHub variable to an https URL (TF_VAR_oauth_redirect_uri)."
  }
}

variable "app_url" {
  description = "Website URL web-auth redirects back to."
  type        = string

  validation {
    condition     = startswith(var.app_url, "https://")
    error_message = "Set the APP_URL GitHub variable to an https URL (TF_VAR_app_url)."
  }
}

variable "admin_user_ids" {
  description = "Discord user ids allowed to run admin commands."
  type        = list(string)
  default     = []
}

variable "admin_role_ids" {
  description = "Discord role ids allowed to run admin commands."
  type        = list(string)
  default     = []
}

variable "trace_sample_ratio" {
  description = "Share of requests traced, from 0 to 1."
  type        = number
  default     = 1
}
