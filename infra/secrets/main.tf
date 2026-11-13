locals {
  project_id = "masterpoulet-${var.environment}"
  secret_ids = toset(["discord-public-key", "discord-oauth-client-secret", "discord-snapshot-webhook", "discord-bot-token"])
  grants = merge(
    { for pair in flatten([for id, members in var.secret_accessors : [for member in members : { id = id, member = member }]]) : "access:${pair.id}:${pair.member}" => merge(pair, { role = "roles/secretmanager.secretAccessor" }) },
    { for pair in flatten([for id, members in var.secret_version_adders : [for member in members : { id = id, member = member }]]) : "rotate:${pair.id}:${pair.member}" => merge(pair, { role = "roles/secretmanager.secretVersionAdder" }) }
  )
}

resource "google_project_service" "secretmanager" {
  project            = local.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_secret_manager_secret" "discord" {
  for_each            = local.secret_ids
  project             = local.project_id
  secret_id           = each.key
  deletion_protection = true
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.inventory_confirmed
      error_message = "Secret inventory is unverified. Enable the API only after approval, inspect metadata and prepare imports/replication before planning containers."
    }
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "grant" {
  for_each  = local.grants
  project   = local.project_id
  secret_id = google_secret_manager_secret.discord[each.value.id].secret_id
  role      = each.value.role
  member    = each.value.member
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = startswith(each.value.member, "user:") || endswith(each.value.member, "@${local.project_id}.iam.gserviceaccount.com")
      error_message = "Runtime secret readers must belong to the selected project, never the other environment."
    }
  }
}
