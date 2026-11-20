# Already owned by both GKE states. Never disable the API during pool migration.
resource "google_project_service" "container" {
  project            = var.project_id
  service            = "container.googleapis.com"
  disable_on_destroy = false
}
