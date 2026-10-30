output "controller_release_name" {
  description = "Terraform-managed ARC controller Helm release."
  value       = helm_release.arc_controller.name
}

output "controller_namespace" {
  description = "Namespace of the controller, separate from future runner workloads."
  value       = helm_release.arc_controller.namespace
}

output "controller_chart_version" {
  description = "Explicit version of the official controller chart."
  value       = helm_release.arc_controller.version
}

output "controller_service_account_name" {
  description = "Kubernetes service account used by ARC; not a GCP node service account."
  value       = "arc-controller"
}

output "kube_context" {
  description = "Explicit local GKE context used by Helm."
  value       = local.kube_context
}
