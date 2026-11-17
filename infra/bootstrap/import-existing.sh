#!/usr/bin/env bash
# Adopt resources that already exist in the project (hand-made WIF, bucket, deployer),
# so `terraform apply` updates them instead of failing with 409.
# Usage: ./import-existing.sh myenv.tfvars   (resources that do not exist are skipped)
set -uo pipefail
vars="${1:?usage: $0 <tfvars file>}"
get() { terraform console -var-file="$vars" <<<"var.$1" | tr -d '"'; }

project=$(get project_id); repo=$(get github_repository); bucket=$(get state_bucket_name)
pool=$(get pool_id); prov=$(get provider_id); sa_id=$(get deployer_account_id)
sa="projects/$project/serviceAccounts/$sa_id@$project.iam.gserviceaccount.com"
poolname="projects/$project/locations/global/workloadIdentityPools/$pool"

imp() {
  terraform state list 2>/dev/null | grep -qxF "$1" && return
  echo ">> import $1"
  terraform import -var-file="$vars" -input=false "$1" "$2" >/dev/null 2>&1 || echo "   skipped (not found)"
}

imp google_storage_bucket.state "$project/$bucket"
imp google_service_account.deployer "$sa"
imp google_iam_workload_identity_pool.github "$poolname"
imp google_iam_workload_identity_pool_provider.github "$poolname/providers/$prov"
imp google_service_account_iam_member.github_impersonation \
  "$sa roles/iam.workloadIdentityUser principalSet://iam.googleapis.com/$poolname/attribute.repository/$repo"
for role in $(grep -oE '"roles/[A-Za-z.]+"' main.tf | tr -d '"' | sort -u); do
  imp "google_project_iam_member.deployer[\"$role\"]" "$project $role serviceAccount:$sa_id@$project.iam.gserviceaccount.com"
done
