resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.api]
}

resource "google_firestore_field" "ttl" {
  for_each   = toset(["ratelimit", "processed"])
  collection = each.key
  field      = "expires_at"

  ttl_config {}

  depends_on = [google_firestore_database.default]
}

resource "google_firebase_project" "this" {
  provider   = google-beta
  depends_on = [google_project_service.api]
}

resource "google_firebaserules_ruleset" "firestore" {
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../../../app/functions/firestore/firestore.rules")
    }
  }

  depends_on = [google_firestore_database.default]
}

resource "google_firebaserules_release" "firestore" {
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}

resource "google_storage_bucket" "snapshots" {
  name                        = "${var.project_id}-pixelwar-snapshots"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  depends_on = [google_project_service.api]
}

resource "google_storage_bucket" "source" {
  name                        = "${var.project_id}-pixelwar-functions-src"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret" "secret" {
  for_each  = toset(["discord-public-key", "discord-oauth-client-secret", "discord-snapshot-webhook", "discord-bot-token"])
  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.api]
}

# Write-only: Terraform sends the value to Secret Manager but never keeps it in the plan or state.
resource "google_secret_manager_secret_version" "secret" {
  for_each               = google_secret_manager_secret.secret
  secret                 = each.value.id
  secret_data_wo         = local.secret_values[each.key]
  secret_data_wo_version = var.secrets_version
}

data "google_firebase_web_app_config" "site" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.site.app_id
}

resource "google_firebase_web_app" "site" {
  provider     = google-beta
  display_name = "pixelwar-${var.project_id}"

  depends_on = [google_firebase_project.this]
}
