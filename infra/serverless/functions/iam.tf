data "google_project" "this" {}

locals {
  pubsub_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  sa           = { for k, v in google_service_account.function : k => "serviceAccount:${v.email}" }

  project_roles = {
    web-proxy         = ["roles/datastore.viewer"]
    draw-pixel        = ["roles/datastore.user"]
    admin-cmd         = ["roles/datastore.user"]
    get-canvas        = ["roles/datastore.viewer"]
    snapshot-worker   = ["roles/datastore.viewer"]
    discord-proxy     = []
    web-auth          = []
    snapshot-notifier = []
  }

  project_bindings = merge([
    for fn in keys(local.function_specs) : {
      for role in concat(local.project_roles[fn], ["roles/logging.logWriter", "roles/telemetry.tracesWriter"]) :
      "${fn}/${role}" => { fn = fn, role = role }
    }
  ]...)

  topic_publishers = {
    "discord-proxy/draw-pixel"         = { fn = "discord-proxy", topic = "draw-pixel" }
    "discord-proxy/commands"           = { fn = "discord-proxy", topic = "commands" }
    "discord-proxy/snapshot-requested" = { fn = "discord-proxy", topic = "snapshot-requested" }
    "web-proxy/draw-pixel"             = { fn = "web-proxy", topic = "draw-pixel" }
  }

  bucket_roles = {
    "get-canvas/roles/storage.objectViewer"        = { fn = "get-canvas", role = "roles/storage.objectViewer" }
    "snapshot-worker/roles/storage.objectUser"     = { fn = "snapshot-worker", role = "roles/storage.objectUser" }
    "snapshot-notifier/roles/storage.objectViewer" = { fn = "snapshot-notifier", role = "roles/storage.objectViewer" }
  }

  secret_readers = {
    "discord-proxy/discord-public-key"           = { fn = "discord-proxy", secret = "discord-public-key" }
    "web-auth/discord-oauth-client-secret"       = { fn = "web-auth", secret = "discord-oauth-client-secret" }
    "snapshot-notifier/discord-snapshot-webhook" = { fn = "snapshot-notifier", secret = "discord-snapshot-webhook" }
  }

  pubsub_triggered = [for k, v in local.subscriptions : k]
  gateway_routed   = ["discord-proxy", "web-proxy", "web-auth"]
}

resource "google_project_iam_member" "function_base" {
  for_each = local.project_bindings
  project  = var.project_id
  role     = each.value.role
  member   = local.sa[each.value.fn]
}

resource "google_pubsub_topic_iam_member" "publisher" {
  for_each = local.topic_publishers
  topic    = google_pubsub_topic.main[each.value.topic].name
  role     = "roles/pubsub.publisher"
  member   = local.sa[each.value.fn]
}

resource "google_storage_bucket_iam_member" "snapshots" {
  for_each = local.bucket_roles
  bucket   = google_storage_bucket.snapshots.name
  role     = each.value.role
  member   = local.sa[each.value.fn]
}

resource "google_secret_manager_secret_iam_member" "read" {
  for_each  = local.secret_readers
  secret_id = google_secret_manager_secret.secret[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.sa[each.value.fn]
}

# Lets snapshot-notifier sign URLs with signBlob as itself.
resource "google_service_account_iam_member" "notifier_signs" {
  service_account_id = google_service_account.function["snapshot-notifier"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.sa["snapshot-notifier"]
}

resource "google_cloud_run_service_iam_member" "push_invoker" {
  for_each = toset(local.pubsub_triggered)
  location = var.region
  service  = google_cloudfunctions2_function.fn[each.key].name
  role     = "roles/run.invoker"
  member   = local.sa["pubsub-push"]
}

resource "google_cloud_run_service_iam_member" "gateway_invoker" {
  for_each = toset(local.gateway_routed)
  location = var.region
  service  = google_cloudfunctions2_function.fn[each.key].name
  role     = "roles/run.invoker"
  member   = local.sa[local.gateway_sa_id]
}

# Dead-lettering needs the Pub/Sub agent to publish to the DLQ and ack on the source subscription.
resource "google_pubsub_topic_iam_member" "dlq_publisher" {
  for_each = toset(local.topics)
  topic    = google_pubsub_topic.dlq[each.key].name
  role     = "roles/pubsub.publisher"
  member   = local.pubsub_agent
}

resource "google_pubsub_subscription_iam_member" "dlq_subscriber" {
  for_each     = local.subscriptions
  subscription = each.key
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent

  depends_on = [google_pubsub_subscription.push]
}

resource "google_pubsub_topic_iam_member" "gcs_publisher" {
  topic  = google_pubsub_topic.main["snapshot-created"].name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

data "google_storage_project_service_account" "gcs" {}

resource "google_pubsub_topic_iam_member" "scheduler_publisher" {
  topic  = google_pubsub_topic.main["snapshot-requested"].name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}
