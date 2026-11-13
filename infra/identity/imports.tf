import {
  to = google_iam_workload_identity_pool.github
  id = "projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/github"
}
import {
  to = google_iam_workload_identity_pool_provider.github
  id = "projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/github/providers/github-oidc"
}
import {
  to = google_service_account.deployer
  id = "projects/${local.project_id}/serviceAccounts/terraform-deployer@${local.project_id}.iam.gserviceaccount.com"
}
import {
  to = google_service_account_iam_member.github
  id = "projects/${local.project_id}/serviceAccounts/terraform-deployer@${local.project_id}.iam.gserviceaccount.com roles/iam.workloadIdentityUser principalSet://iam.googleapis.com/projects/${data.google_project.current.number}/locations/global/workloadIdentityPools/github/attribute.repository/${local.repository}"
}
import {
  to = google_project_iam_member.network
  id = "${local.project_id} roles/compute.networkAdmin serviceAccount:terraform-deployer@${local.project_id}.iam.gserviceaccount.com"
}
