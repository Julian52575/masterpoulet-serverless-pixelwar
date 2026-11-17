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

variable "app_url" {
  description = "Website URL web-auth redirects back to."
  type        = string

  validation {
    condition     = can(regex("^(https://|http://(localhost|127\\.0\\.0\\.1)[:/])", var.app_url))
    error_message = "Set the APP_URL GitHub variable to an https URL, or http://localhost (TF_VAR_app_url)."
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

variable "discord_public_key" {
  description = "Discord application public key (interaction signature check)."
  type        = string
  sensitive   = true
  ephemeral   = true

  validation {
    condition     = length(var.discord_public_key) > 0
    error_message = "Set the DISCORD_PUBLIC_KEY GitHub secret (TF_VAR_discord_public_key)."
  }
}

variable "discord_oauth_client_secret" {
  description = "Discord OAuth client secret."
  type        = string
  sensitive   = true
  ephemeral   = true

  validation {
    condition     = length(var.discord_oauth_client_secret) > 0
    error_message = "Set the DISCORD_OAUTH_CLIENT_SECRET GitHub secret (TF_VAR_discord_oauth_client_secret)."
  }
}

variable "discord_snapshot_webhook" {
  description = "Discord webhook URL that receives the snapshots."
  type        = string
  sensitive   = true
  ephemeral   = true

  validation {
    condition     = length(var.discord_snapshot_webhook) > 0
    error_message = "Set the DISCORD_SNAPSHOT_WEBHOOK GitHub secret (TF_VAR_discord_snapshot_webhook)."
  }
}

variable "discord_bot_token" {
  description = "Discord bot token."
  type        = string
  sensitive   = true
  ephemeral   = true

  validation {
    condition     = length(var.discord_bot_token) > 0
    error_message = "Set the DISCORD_BOT_TOKEN GitHub secret (TF_VAR_discord_bot_token)."
  }
}

variable "secrets_version" {
  description = "Write-only values leave no trace in state, so bump this number to push changed secret values."
  type        = number
  default     = 1
}
