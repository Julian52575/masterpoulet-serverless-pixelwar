locals {
  project_id = "masterpoulet-${var.environment}"
}

# Adoption of the three confirmed existing Owner grants only, not a target privilege model.
resource "google_project_iam_member" "team" {
  for_each = var.team_members
  project  = local.project_id
  role     = "roles/owner"
  member   = each.value
  lifecycle {
    prevent_destroy = true
  }
}

# Subject section 1.3 explicitly requires this Editor exception.
resource "google_project_iam_member" "instructor" {
  project = local.project_id
  role    = "roles/editor"
  member  = "user:jeremie@jjaouen.com"
  lifecycle {
    prevent_destroy = true
  }
}
