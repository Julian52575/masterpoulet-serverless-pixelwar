locals {
  project_id       = "masterpoulet-${var.environment}"
  state_bucket     = var.environment == "dev" ? "masterpoulet_bucket" : "masterpoulet_prod_bucket"
  repository       = "Julian52575/masterpoulet-serverless-pixelwar"
  repository_id    = "1429469761"
  owner_id         = "114570075"
  pool_description = var.environment == "dev" ? "Github Dev Github Actions" : "GitHub Actions prd env"
  sa_description   = var.environment == "dev" ? "terraform-deployer dev env" : "GitHub actions prod env"
  subjects = [
    "repo:${local.repository}:environment:${var.environment}",
    "repo:Julian52575@${local.owner_id}/masterpoulet-serverless-pixelwar@${local.repository_id}:environment:${var.environment}"
  ]
  workflow_refs = [for ref in sort(tolist(var.trusted_refs)) : "${local.repository}/.github/workflows/terraform-deploy.yml@${ref}"]
}

data "google_project" "current" {
  project_id = local.project_id
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = data.google_project.current.number
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = local.pool_description
  disabled                  = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = data.google_project.current.number
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  disabled                           = false

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.environment"         = "assertion.environment"
    "attribute.ref"                 = "assertion.ref"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
  attribute_condition = join(" && ", [
    "assertion.repository == '${local.repository}'",
    "assertion.repository_id == '${local.repository_id}'",
    "assertion.repository_owner_id == '${local.owner_id}'",
    "assertion.environment == '${var.environment}'",
    "assertion.sub in ${jsonencode(local.subjects)}",
    "assertion.ref in ${jsonencode(sort(tolist(var.trusted_refs)))}",
    "assertion.workflow_ref in ${jsonencode(local.workflow_refs)}",
    "assertion.event_name == 'workflow_dispatch'"
  ])
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "deployer" {
  project      = local.project_id
  account_id   = "terraform-deployer"
  display_name = "terraform-deployer"
  description  = local.sa_description
  disabled     = false
  lifecycle {
    prevent_destroy = true
  }
}

# Preserve the existing additive binding; trust is restricted by the only GitHub provider in this pool.
resource "google_service_account_iam_member" "github" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${local.repository}"
  lifecycle {
    prevent_destroy = true
  }
}

# Existing foundation deployer only: no IAM administration, GKE or application roles.
resource "google_project_iam_member" "network" {
  project = local.project_id
  role    = "roles/compute.networkAdmin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_custom_role" "state" {
  project     = local.project_id
  role_id     = "terraformFoundationState"
  title       = "Terraform foundation state"
  description = "Only the object CRUD/list operations needed by the foundation GCS backend."
  permissions = ["storage.objects.get", "storage.objects.create", "storage.objects.update", "storage.objects.delete", "storage.objects.list"]
  stage       = "GA"
  lifecycle {
    prevent_destroy = true
  }
}

# A conditional grant alone does NOT remove the pre-existing bucket-wide grant.
resource "google_storage_bucket_iam_member" "state" {
  bucket = local.state_bucket
  role   = google_project_iam_custom_role.state.name
  member = "serviceAccount:${google_service_account.deployer.email}"
  condition {
    title       = "foundation-${var.environment}-state"
    description = "List the bucket and manage only canonical foundation state/lock objects."
    expression  = "resource.name == 'projects/_/buckets/${local.state_bucket}' || resource.name.startsWith('projects/_/buckets/${local.state_bucket}/objects/foundation/${var.environment}/')"
  }
  lifecycle {
    prevent_destroy = true
  }
}
