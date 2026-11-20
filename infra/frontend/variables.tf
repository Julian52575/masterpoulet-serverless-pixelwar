variable "project_id" {
  type        = string
  description = "Google Cloud project id"
}

variable "region" {
  type        = string
  description = "Default GCP region"
  default     = "europe-west1"
}
