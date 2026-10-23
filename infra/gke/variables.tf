variable "project_id" {
  description = "Target GCP project selected by the environment tfvars."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a valid GCP project ID."
  }
}

variable "region" {
  description = "Region containing the existing subnet and cluster zone."
  type        = string
}

variable "zone" {
  description = "Single zone for the Standard cluster and its nodes."
  type        = string
}

variable "cluster_name" {
  description = "Name of the GKE Standard cluster."
  type        = string
}

variable "network_name" {
  description = "Existing VPC managed by the foundation stack."
  type        = string
}

variable "subnet_name" {
  description = "Existing subnet managed by the foundation stack."
  type        = string
}

variable "pods_range_name" {
  description = "Existing secondary range name for Pods."
  type        = string
}

variable "services_range_name" {
  description = "Existing secondary range name for Services."
  type        = string
}

variable "node_service_account_id" {
  description = "Dedicated node service account ID, without email domain."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.node_service_account_id))
    error_message = "Use a 6-30 character service account ID."
  }
}

variable "node_pool_name" {
  description = "Name of the single runner node pool."
  type        = string
  default     = "github-runners"
}

variable "machine_type" {
  description = "On-demand machine type; no GPU or Spot nodes."
  type        = string
  default     = "e2-standard-2"
}

variable "disk_size_gb" {
  description = "Boot disk size per node."
  type        = number
  default     = 30

  validation {
    condition     = var.disk_size_gb >= 30 && floor(var.disk_size_gb) == var.disk_size_gb
    error_message = "Use an integer disk size of at least 30 GB."
  }
}

variable "disk_type" {
  description = "Boot disk type per node."
  type        = string
  default     = "pd-standard"
}

variable "node_autoscaling" {
  description = "Minimum and maximum nodes across the single zone."
  type = object({
    min = number
    max = number
  })
  default = { min = 1, max = 2 }

  validation {
    condition = (
      var.node_autoscaling.min >= 1 &&
      var.node_autoscaling.max >= var.node_autoscaling.min &&
      floor(var.node_autoscaling.min) == var.node_autoscaling.min &&
      floor(var.node_autoscaling.max) == var.node_autoscaling.max
    )
    error_message = "Use integer limits with 1 <= min <= max."
  }
}

variable "deletion_protection" {
  description = "Keep true for PROD; false allows later reviewed demo teardown."
  type        = bool
  default     = true
}
