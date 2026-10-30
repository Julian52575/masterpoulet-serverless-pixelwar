variable "project_id" {
  description = "GCP project of the existing GKE cluster; also selects its kubeconfig context."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a valid GCP project ID."
  }
}

variable "zone" {
  description = "Zone of the existing zonal GKE cluster."
  type        = string
}

variable "cluster_name" {
  description = "Existing GKE cluster name; this stack cannot create or modify it."
  type        = string
}

variable "node_pool_name" {
  description = "Existing node pool used by the controller through its GKE node label."
  type        = string
  default     = "github-runners"
}

variable "kubeconfig_path" {
  description = "Local kubeconfig with the explicit GKE context and exec authentication; never commit its contents."
  type        = string
  default     = "~/.kube/config"
}

variable "controller_chart_version" {
  description = "Exact stable version of the official GitHub controller chart, verified before upgrading."
  type        = string
  default     = "0.15.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.controller_chart_version))
    error_message = "Pin a verified stable chart version, such as 0.15.0; do not use latest or a version range."
  }
}

variable "controller_resources" {
  description = "Kubernetes requests and limits for the single controller, excluding future runners."
  type = object({
    requests = object({ cpu = string, memory = string })
    limits   = object({ cpu = string, memory = string })
  })
  default = {
    requests = { cpu = "100m", memory = "128Mi" }
    limits   = { cpu = "500m", memory = "256Mi" }
  }
}
