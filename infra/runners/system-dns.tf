# GKE supports tuning this ConfigMap; do not replace its Deployment or Service.
data "kubernetes_config_map_v1" "dns_autoscaler" {
  metadata {
    name      = "kube-dns-autoscaler"
    namespace = "kube-system"
  }
}

resource "kubernetes_config_map_v1_data" "dns_autoscaler" {
  metadata {
    name      = data.kubernetes_config_map_v1.dns_autoscaler.metadata[0].name
    namespace = data.kubernetes_config_map_v1.dns_autoscaler.metadata[0].namespace
  }

  # Only take ownership of linear, previously written by the GKE autoscaler.
  field_manager = "terraform-node-pools"
  force         = true
  data = {
    linear = jsonencode(merge(
      jsondecode(data.kubernetes_config_map_v1.dns_autoscaler.data["linear"]),
      {
        min                       = 1
        max                       = 1
        preventSinglePointFailure = false
      }
    ))
  }

  lifecycle {
    # Removing owned data can reset DNS scaling; rollback must restore it first.
    prevent_destroy = true
  }
}
