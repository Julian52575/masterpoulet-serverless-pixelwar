resource "helm_release" "arc_runner_scale_set" {
  name             = var.runner_scale_set_name
  namespace        = "arc-runners"
  create_namespace = false
  repository       = "oci://ghcr.io/actions/actions-runner-controller-charts"
  chart            = "gha-runner-scale-set"
  version          = var.controller_chart_version

  atomic           = true
  wait             = true
  timeout          = 300
  max_history      = 3
  lint             = true
  force_update     = false
  replace          = false
  pass_credentials = false

  # Only reference the manually managed Secret; never read its data into Terraform.
  values = [yamlencode({
    githubConfigUrl    = "https://github.com/Julian52575/masterpoulet-serverless-pixelwar"
    githubConfigSecret = "arc-rw"
    runnerScaleSetName = var.runner_scale_set_name
    minRunners         = 0
    maxRunners         = 2
    controllerServiceAccount = {
      namespace = helm_release.arc_controller.namespace
      name      = "arc-controller"
    }
    listenerTemplate = {
      spec = {
        nodeSelector = var.system_node_selector
        containers = [{
          name      = "listener"
          resources = var.listener_resources
          securityContext = {
            allowPrivilegeEscalation = false
            runAsNonRoot             = true
            runAsUser                = 1000
            capabilities             = { drop = ["ALL"] }
          }
        }]
        securityContext = { seccompProfile = { type = "RuntimeDefault" } }
      }
    }
    template = {
      spec = {
        nodeSelector                 = merge(var.worker_node_selector, { "cloud.google.com/gke-nodepool" = var.node_pool_name })
        tolerations                  = var.worker_tolerations
        automountServiceAccountToken = false
        securityContext              = { seccompProfile = { type = "RuntimeDefault" } }
        containers = [{
          name    = "runner"
          image   = "ghcr.io/actions/actions-runner:2.338.2"
          command = ["/home/runner/run.sh"]
          resources = {
            requests = { cpu = "500m", memory = "512Mi", "ephemeral-storage" = "1Gi" }
            limits   = { cpu = "1", memory = "1Gi", "ephemeral-storage" = "2Gi" }
          }
          securityContext = {
            allowPrivilegeEscalation = false
            runAsNonRoot             = true
            runAsUser                = 1001
            capabilities             = { drop = ["ALL"] }
          }
        }]
      }
    }
  })]

  depends_on = [helm_release.arc_controller]
}
