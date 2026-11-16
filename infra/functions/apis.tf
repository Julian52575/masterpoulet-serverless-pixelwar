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
