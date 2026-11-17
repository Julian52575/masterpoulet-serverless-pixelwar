locals {
  apis = [
    "cloudfunctions", "run", "cloudbuild", "artifactregistry", "eventarc",
    "pubsub", "firestore", "storage", "secretmanager", "cloudscheduler",
    "apigateway", "servicemanagement", "servicecontrol", "iamcredentials",
    "firebase", "firebaserules", "logging", "cloudtrace", "telemetry",
  ]
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

# Cloud Functions builds push here; created up front so parallel first builds don't race to create it.
resource "google_artifact_registry_repository" "gcf_artifacts" {
  repository_id = "gcf-artifacts"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.api]
}

# Cloud Functions auto-creates this bucket on the first deploy; parallel functions race to do it (409).
resource "google_storage_bucket" "gcf_sources" {
  name                        = "gcf-v2-sources-${data.google_project.this.number}-${var.region}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  depends_on                  = [google_project_service.api]
}
