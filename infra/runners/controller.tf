resource "helm_release" "arc_controller" {
  name             = "arc"
  namespace        = "arc-systems"
  create_namespace = true
  repository       = "oci://ghcr.io/actions/actions-runner-controller-charts"
  chart            = "gha-runner-scale-set-controller"
  version          = var.controller_chart_version

  atomic           = true
  wait             = true
  timeout          = 300
  max_history      = 3
  lint             = true
  skip_crds        = false
  force_update     = false
  replace          = false
  pass_credentials = false

  # Only non-secret chart values belong here: no GitHub App, PAT or runner scale set.
  values = [yamlencode({
    replicaCount = 1
    resources    = var.controller_resources
    nodeSelector = var.system_node_selector
    serviceAccount = {
      create = true
      name   = "arc-controller"
    }
    securityContext = {
      allowPrivilegeEscalation = false
      readOnlyRootFilesystem   = true
      runAsNonRoot             = true
      capabilities             = { drop = ["ALL"] }
    }
    podSecurityContext = {
      seccompProfile = { type = "RuntimeDefault" }
    }
    flags = {
      logLevel  = "info"
      logFormat = "json"
    }
  })]

  depends_on = [kubernetes_config_map_v1_data.dns_autoscaler]
}
