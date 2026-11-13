import {
  for_each = var.existing_secret_ids
  to       = google_secret_manager_secret.discord[each.key]
  id       = "projects/${local.project_id}/secrets/${each.key}"
}
