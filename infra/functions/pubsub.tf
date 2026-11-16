locals {
  topics = ["draw-pixel", "commands", "snapshot-requested", "snapshot-created"]

  subscriptions = {
    draw-pixel        = { topic = "draw-pixel", ack = 60, filter = null }
    admin-cmd         = { topic = "commands", ack = 600, filter = "hasPrefix(attributes.type, \"admin.\")" }
    get-canvas        = { topic = "commands", ack = 300, filter = "attributes.type = \"get\"" }
    snapshot-worker   = { topic = "snapshot-requested", ack = 600, filter = null }
    snapshot-notifier = { topic = "snapshot-created", ack = 60, filter = null }
  }
}

resource "google_pubsub_topic" "main" {
  for_each   = toset(local.topics)
  name       = each.key
  depends_on = [google_project_service.api]
}

resource "google_pubsub_topic" "dlq" {
  for_each = toset(local.topics)
  name     = "${each.key}-dlq"
}

resource "google_pubsub_subscription" "dlq" {
  for_each                   = toset(local.topics)
  name                       = "${each.key}-dlq-sub"
  topic                      = google_pubsub_topic.dlq[each.key].id
  message_retention_duration = "604800s"
  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_subscription" "push" {
  for_each                   = local.subscriptions
  name                       = each.key
  topic                      = google_pubsub_topic.main[each.value.topic].id
  filter                     = each.value.filter
  ack_deadline_seconds       = each.value.ack
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = google_cloudfunctions2_function.fn[each.key].service_config[0].uri
    oidc_token {
      service_account_email = google_service_account.function["pubsub-push"].email
      audience              = google_cloudfunctions2_function.fn[each.key].service_config[0].uri
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq[each.value.topic].id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [
    google_pubsub_topic_iam_member.dlq_publisher,
  ]
}

resource "google_storage_notification" "snapshot_created" {
  bucket             = google_storage_bucket.snapshots.name
  topic              = google_pubsub_topic.main["snapshot-created"].id
  payload_format     = "JSON_API_V1"
  event_types        = ["OBJECT_FINALIZE"]
  object_name_prefix = "snapshots/"

  depends_on = [google_pubsub_topic_iam_member.gcs_publisher]
}

resource "google_cloud_scheduler_job" "snapshot" {
  name      = "snapshot-every-5-minutes"
  region    = var.region
  schedule  = "*/5 * * * *"
  time_zone = "Etc/UTC"

  pubsub_target {
    topic_name = google_pubsub_topic.main["snapshot-requested"].id
    data       = base64encode("{\"type\":\"snapshot.scheduled\"}")
    attributes = { type = "snapshot.scheduled" }
  }

  depends_on = [google_project_service.api]
}
