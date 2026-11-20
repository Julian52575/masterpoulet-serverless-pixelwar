#!/usr/bin/env bash
# Imports resources that already exist in GCP but not in state (earlier or partial deploys),
# so plan/apply/destroy don't fail with 409. Missing objects are skipped. Run from this directory with TF_ENV set.
# Keep the name lists in sync with apis.tf, pubsub.tf, functions.tf and data.tf.
set -uo pipefail

project=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "${TF_ENV}.tfvars")
region=$(sed -n 's/^region *= *"\(.*\)"/\1/p' "${TF_ENV}.tfvars")
number=$(gcloud projects describe "$project" --format='value(projectNumber)')

state=$(terraform state list 2>/dev/null || true)

adopt() {
  grep -qxF -- "$1" <<<"$state" && return 0
  local out
  if ! out=$(terraform import -input=false -no-color -var-file="${TF_ENV}.tfvars" "$1" "$2" 2>&1); then
    if grep -q 'Error acquiring the state lock' <<<"$out"; then
      echo "::error::state is locked; aborting adoption"
      exit 1
    fi
    echo "::notice::$1 not adopted (missing or not importable)"
    grep -q 'Cannot import non-existent' <<<"$out" || echo "$out" | grep -m1 'Error:' || true
  fi
}

apis=(cloudfunctions run cloudbuild artifactregistry eventarc pubsub firestore storage secretmanager
  cloudscheduler apigateway servicemanagement servicecontrol iamcredentials firebase firebaserules
  logging cloudtrace telemetry)
topics=(draw-pixel commands snapshot-requested snapshot-created)
subs=(draw-pixel admin-cmd get-canvas snapshot-worker snapshot-notifier)
secrets=(discord-public-key discord-oauth-client-secret discord-snapshot-webhook discord-bot-token)
functions=(discord-proxy web-proxy web-auth draw-pixel admin-cmd get-canvas snapshot-worker snapshot-notifier)
accounts=("${functions[@]}" pubsub-push api-gateway)

for a in "${apis[@]}"; do
  adopt "google_project_service.api[\"$a\"]" "${project}/${a}.googleapis.com"
done

adopt google_artifact_registry_repository.gcf_artifacts "projects/${project}/locations/${region}/repositories/gcf-artifacts"
adopt google_storage_bucket.gcf_sources "${project}/gcf-v2-sources-${number}-${region}"
adopt google_storage_bucket.snapshots "${project}/${project}-pixelwar-snapshots"
adopt google_storage_bucket.source "${project}/${project}-pixelwar-functions-src"
adopt google_firestore_database.default "projects/${project}/databases/(default)"
for c in ratelimit processed; do
  adopt "google_firestore_field.ttl[\"$c\"]" "projects/${project}/databases/(default)/collectionGroups/${c}/fields/expires_at"
done
adopt google_firebase_project.this "projects/${project}"
adopt google_firebaserules_release.firestore "projects/${project}/releases/cloud.firestore"

for s in "${secrets[@]}"; do
  adopt "google_secret_manager_secret.secret[\"$s\"]" "projects/${project}/secrets/${s}"
done
for t in "${topics[@]}"; do
  adopt "google_pubsub_topic.main[\"$t\"]" "projects/${project}/topics/${t}"
  adopt "google_pubsub_topic.dlq[\"$t\"]" "projects/${project}/topics/${t}-dlq"
  adopt "google_pubsub_subscription.dlq[\"$t\"]" "projects/${project}/subscriptions/${t}-dlq-sub"
done
for s in "${subs[@]}"; do
  adopt "google_pubsub_subscription.push[\"$s\"]" "projects/${project}/subscriptions/${s}"
done

for a in "${accounts[@]}"; do
  adopt "google_service_account.function[\"$a\"]" "projects/${project}/serviceAccounts/${a}@${project}.iam.gserviceaccount.com"
done
for f in "${functions[@]}"; do
  adopt "google_cloudfunctions2_function.fn[\"$f\"]" "projects/${project}/locations/${region}/functions/${f}"
done

adopt google_cloud_scheduler_job.snapshot "projects/${project}/locations/${region}/jobs/snapshot-every-5-minutes"
adopt google_api_gateway_api.api "projects/${project}/locations/global/apis/pixelwar"
adopt google_api_gateway_gateway.gateway "projects/${project}/locations/${region}/gateways/pixelwar"
