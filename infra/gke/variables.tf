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
  description = "Name of the existing worker pool; preserve it during migration."
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
  default = { min = 0, max = 2 }

  validation {
    condition = (
      var.node_autoscaling.min >= 0 &&
      var.node_autoscaling.max >= var.node_autoscaling.min &&
      floor(var.node_autoscaling.min) == var.node_autoscaling.min &&
      floor(var.node_autoscaling.max) == var.node_autoscaling.max
    )
    error_message = "Use integer total limits with 0 <= min <= max."
  }
}

variable "system_node_pool_name" {
  description = "Permanent system pool, distinct from the existing worker pool."
  type        = string
  default     = "system"
}

variable "system_machine_type" {
  description = "e2-small cannot fit the audited system requests; e2-medium requires capacity checks before migration."
  type        = string
  default     = "e2-medium"
}

variable "system_node_count" {
  description = "Fixed total system capacity in the single configured zone; no autoscaling."
  type        = number
  default     = 1

  validation {
    condition     = var.system_node_count >= 1 && floor(var.system_node_count) == var.system_node_count
    error_message = "Keep at least one permanent system node."
  }
}

variable "system_disk_size_gb" {
  description = "System boot disk; 30 GiB retains room for GKE agents and logs."
  type        = number
  default     = 30

  validation {
    condition     = var.system_disk_size_gb >= 30 && floor(var.system_disk_size_gb) == var.system_disk_size_gb
    error_message = "Use an integer system disk size of at least 30 GiB."
  }
}

variable "system_node_labels" {
  description = "Node labels used by permanent workloads. Match the runners root selectors."
  type        = map(string)
  default     = { workload = "system" }
}

variable "worker_node_labels" {
  description = "Node labels for ephemeral compute. Match the runners root selectors."
  type        = map(string)
  default     = { workload = "worker" }
}

variable "worker_node_taints" {
  description = "Worker isolation; runner tolerations in the runners root must match."
  type        = list(object({ key = string, value = string, effect = string }))
  default     = [{ key = "workload", value = "worker", effect = "NO_SCHEDULE" }]

  validation {
    condition     = alltrue([for taint in var.worker_node_taints : contains(["NO_SCHEDULE", "PREFER_NO_SCHEDULE", "NO_EXECUTE"], taint.effect)])
    error_message = "Use a GKE taint effect: NO_SCHEDULE, PREFER_NO_SCHEDULE or NO_EXECUTE."
  }
}

variable "deletion_protection" {
  description = "Keep true for PROD; false allows later reviewed demo teardown."
  type        = bool
  default     = true
}
