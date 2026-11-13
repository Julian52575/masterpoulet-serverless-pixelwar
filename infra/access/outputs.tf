output "project_id" {
  value = local.project_id
}

output "team_grants" {
  value = { for member, grant in google_project_iam_member.team : member => grant.role }
}
