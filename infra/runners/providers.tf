terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
  }
}

locals {
  kube_context = "gke_${var.project_id}_${var.zone}_${var.cluster_name}"
}

# The kubeconfig exec plugin obtains short-lived credentials outside Terraform.
provider "helm" {
  kubernetes = {
    config_path    = pathexpand(var.kubeconfig_path)
    config_context = local.kube_context
  }
}
