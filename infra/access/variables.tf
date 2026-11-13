variable "environment" {
  type        = string
  description = "Project and backend environment; never mix dev and prod."
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Use dev or prod."
  }
}

variable "team_members" {
  type        = set(string)
  description = "Exactly three confirmed existing Owner principals; import is required, never grant Owner to a new user."
  validation {
    condition     = length(var.team_members) == 3 && alltrue([for m in var.team_members : can(regex("^user:[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", m))])
    error_message = "Supply exactly three distinct confirmed human user:email identities."
  }
}
