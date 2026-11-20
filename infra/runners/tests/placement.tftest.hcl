mock_provider "helm" {}
mock_provider "kubernetes" {
  mock_data "kubernetes_config_map_v1" {
    defaults = {
      data = {
        linear = "{\"coresPerReplica\":256,\"nodesPerReplica\":16,\"includeUnschedulableNodes\":true,\"preventSinglePointFailure\":true}"
      }
    }
  }
}

run "zero_worker_control_path" {
  command = plan

  assert {
    condition = (
      jsondecode(kubernetes_config_map_v1_data.dns_autoscaler.data["linear"]).min == 1 &&
      jsondecode(kubernetes_config_map_v1_data.dns_autoscaler.data["linear"]).max == 1 &&
      !jsondecode(kubernetes_config_map_v1_data.dns_autoscaler.data["linear"]).preventSinglePointFailure &&
      jsondecode(kubernetes_config_map_v1_data.dns_autoscaler.data["linear"]).includeUnschedulableNodes
    )
    error_message = "Workers must not add redundant DNS replicas on the single system node; preserve the other autoscaler settings."
  }

  assert {
    condition = (
      yamldecode(helm_release.arc_controller.values[0]).nodeSelector.workload == "system" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).listenerTemplate.spec.nodeSelector.workload == "system"
    )
    error_message = "Controller and listener must be schedulable independently of workers."
  }

  assert {
    condition = (
      yamldecode(helm_release.arc_runner_scale_set.values[0]).template.spec.nodeSelector.workload == "worker" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).template.spec.nodeSelector["cloud.google.com/gke-nodepool"] == "github-runners" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).template.spec.tolerations[0].effect == "NoSchedule" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).minRunners == 0 &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).maxRunners == 2
    )
    error_message = "Only ephemeral runners tolerate workers, with zero idle runners and at most two active runners."
  }

  assert {
    condition = (
      yamldecode(helm_release.arc_controller.values[0]).resources.requests.memory == "64Mi" &&
      yamldecode(helm_release.arc_controller.values[0]).resources.limits.memory == "256Mi" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).listenerTemplate.spec.containers[0].resources.requests.memory == "64Mi" &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).listenerTemplate.spec.containers[0].resources.limits.memory == "256Mi"
    )
    error_message = "ARC requests must fit the audited budget while retaining the existing burst limits."
  }

  assert {
    condition = (
      helm_release.arc_runner_scale_set.name == var.runner_scale_set_name &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).runnerScaleSetName == var.runner_scale_set_name &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).githubConfigSecret == "arc-rw"
    )
    error_message = "Preserve existing runner routing and authentication."
  }
}
