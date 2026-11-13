mock_provider "google" {}

override_resource {
  target = google_project_iam_member.instructor
  values = {}
}
override_resource {
  target = google_project_iam_member.team
  values = {}
}

variables {
  environment  = "dev"
  team_members = ["user:JBottiglione88@gmail.com", "user:louislorrainm@gmail.com", "user:somnarem@gmail.com"]
}

run "adopt_existing_access_without_redundant_grants" {
  command = plan
  assert {
    condition     = length(google_project_iam_member.team) == 3 && alltrue([for grant in google_project_iam_member.team : grant.role == "roles/owner"])
    error_message = "Adopt only the three existing Owner grants, without adding redundant Viewer/Editor team bindings."
  }
  assert {
    condition     = google_project_iam_member.instructor.member == "user:jeremie@jjaouen.com" && google_project_iam_member.instructor.role == "roles/editor"
    error_message = "Keep the instructor exception required by the subject."
  }
}

run "unknown_team_is_blocked" {
  command = plan
  variables {
    team_members = []
  }
  expect_failures = [var.team_members]
}

run "invalid_environment_is_rejected" {
  command = plan
  variables {
    environment = "prd"
  }
  expect_failures = [var.environment]
}
