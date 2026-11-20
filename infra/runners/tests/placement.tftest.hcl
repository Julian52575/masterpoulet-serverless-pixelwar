mock_provider "helm" {}

run "zero_worker_control_path" {
  command = plan

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
      helm_release.arc_runner_scale_set.name == var.runner_scale_set_name &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).runnerScaleSetName == var.runner_scale_set_name &&
      yamldecode(helm_release.arc_runner_scale_set.values[0]).githubConfigSecret == "arc-rw"
    )
    error_message = "Preserve existing runner routing and authentication."
  }
}
