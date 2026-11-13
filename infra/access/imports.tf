# Preparation only. A plan reads the existing binding; only an approved apply adopts it.
import {
  for_each = var.team_members
  to       = google_project_iam_member.team[each.key]
  id       = "${local.project_id} roles/owner ${each.key}"
}

import {
  to = google_project_iam_member.instructor
  id = "${local.project_id} roles/editor user:jeremie@jjaouen.com"
}
