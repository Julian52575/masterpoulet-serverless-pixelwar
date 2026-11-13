variable "environment" {
  type        = string
  description = "Isolated GCP project containing the secret containers."
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Use dev or prod."
  }
}

variable "inventory_confirmed" {
  type        = bool
  description = "Set true only after the Secret Manager metadata inventory is accessible and existing IDs/replication have been reconciled."
  default     = false
}

variable "existing_secret_ids" {
  type        = set(string)
  description = "Observed existing IDs to import; never assume an inaccessible API means no secrets."
  default     = []
  validation {
    condition     = alltrue([for id in var.existing_secret_ids : contains(["discord-public-key", "discord-oauth-client-secret", "discord-snapshot-webhook", "discord-bot-token"], id)])
    error_message = "Use only one of the four documented Discord secret IDs."
  }
}

variable "secret_accessors" {
  type        = map(set(string))
  description = "Per-secret existing runtime identities; bot-token readers must be human operators. Empty until the application identities exist."
  default     = {}
  validation {
    condition     = alltrue([for id, members in var.secret_accessors : contains(["discord-public-key", "discord-oauth-client-secret", "discord-snapshot-webhook", "discord-bot-token"], id) && alltrue([for m in members : can(regex(id == "discord-bot-token" ? "^user:[^@[:space:]]+@[^@[:space:]]+$" : "^serviceAccount:[^@[:space:]]+@[^@[:space:]]+\\.iam\\.gserviceaccount\\.com$", m))])])
    error_message = "Use documented IDs; serviceAccount: readers for runtime secrets and user: readers only for the registration bot token."
  }
}

variable "secret_version_adders" {
  type        = map(set(string))
  description = "Explicit human rotation operators, scoped to each secret; cannot read secret values through this role."
  default     = {}
  validation {
    condition     = alltrue([for id, members in var.secret_version_adders : contains(["discord-public-key", "discord-oauth-client-secret", "discord-snapshot-webhook", "discord-bot-token"], id) && alltrue([for m in members : can(regex("^user:[^@[:space:]]+@[^@[:space:]]+$", m))])])
    error_message = "Specify documented IDs and explicit human user:email rotation operators."
  }
}
