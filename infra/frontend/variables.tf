variable "project_id" {
  type        = string
  description = "Google Cloud project id"
}

variable "region" {
  type        = string
  description = "Default GCP region"
  default     = "europe-west1"
}

variable "bucket_name" {
  type        = string
  description = "Optional custom name for the frontend static assets bucket (defaults to {project_id}-frontend)"
  default     = ""
}
