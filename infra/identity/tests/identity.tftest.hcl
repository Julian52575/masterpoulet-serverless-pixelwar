mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "539044310096"
    }
  }
}

override_resource {
  target = google_iam_workload_identity_pool.github
  values = {}
}
override_resource {
  target = google_iam_workload_identity_pool_provider.github
  values = {}
}
override_resource {
  target = google_service_account.deployer
  values = {
    name  = "projects/masterpoulet-dev/serviceAccounts/terraform-deployer@masterpoulet-dev.iam.gserviceaccount.com"
    email = "terraform-deployer@masterpoulet-dev.iam.gserviceaccount.com"
  }
}
override_resource {
  target = google_service_account_iam_member.github
  values = {}
}
override_resource {
  target = google_project_iam_member.network
  values = {}
}
override_resource {
  target = google_project_iam_custom_role.state
  values = {
    name = "projects/masterpoulet-dev/roles/terraformFoundationState"
  }
}

run "dev_trust_boundary" {
  command = plan
  variables {
    environment = "dev"
  }
  assert {
    condition = alltrue([
      for restriction in [
        "assertion.repository_id == '1429469761'",
        "assertion.repository_owner_id == '114570075'",
        "assertion.environment == 'dev'",
        "assertion.event_name == 'workflow_dispatch'",
        "assertion.sub in", "assertion.ref in", "assertion.workflow_ref in",
        "terraform-deploy.yml@refs/heads/main"
      ] : strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, restriction)
    ])
    error_message = "Trust must pin numeric ownership, environment, subject, ref and the authorized workflow."
  }
  assert {
    condition     = google_project_iam_member.network.role == "roles/compute.networkAdmin"
    error_message = "The ordinary deployer must not become an IAM/Owner/Editor administrator."
  }
  assert {
    condition     = google_iam_workload_identity_pool.github.project == "539044310096" && google_iam_workload_identity_pool_provider.github.project == "539044310096"
    error_message = "Use the imported canonical project number to avoid replacing the existing DEV federation."
  }
  assert {
    condition     = google_storage_bucket_iam_member.state.condition[0].expression == "resource.name == 'projects/_/buckets/masterpoulet_bucket' || resource.name.startsWith('projects/_/buckets/masterpoulet_bucket/objects/foundation/dev/')"
    error_message = "The ordinary deployer may list the bucket but must not get/write access/identity/secrets state objects."
  }
  assert {
    condition     = toset(google_project_iam_custom_role.state.permissions) == toset(["storage.objects.get", "storage.objects.create", "storage.objects.update", "storage.objects.delete", "storage.objects.list"])
    error_message = "State access must not include object IAM, restoration, retention or bucket administration."
  }
}

run "prod_is_not_dev" {
  command = plan
  variables {
    environment = "prod"
  }
  override_data {
    target = data.google_project.current
    values = { number = "992884593424" }
  }
  override_resource {
    target = google_service_account.deployer
    values = {
      name  = "projects/masterpoulet-prod/serviceAccounts/terraform-deployer@masterpoulet-prod.iam.gserviceaccount.com"
      email = "terraform-deployer@masterpoulet-prod.iam.gserviceaccount.com"
    }
  }
  override_resource {
    target = google_project_iam_custom_role.state
    values = {
      name = "projects/masterpoulet-prod/roles/terraformFoundationState"
    }
  }
  assert {
    condition     = google_service_account.deployer.project == "masterpoulet-prod" && strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.environment == 'prod'") && !strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "environment:dev")
    error_message = "PROD trust and service account must not accept DEV's environment subject."
  }
  assert {
    condition     = google_iam_workload_identity_pool.github.project == "992884593424" && google_iam_workload_identity_pool_provider.github.project == "992884593424"
    error_message = "PROD federation must keep its imported canonical project number."
  }
}

run "wildcard_refs_are_rejected" {
  command = plan
  variables {
    environment  = "prod"
    trusted_refs = ["refs/tags/*"]
  }
  expect_failures = [var.trusted_refs]
}
