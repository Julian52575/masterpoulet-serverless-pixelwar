locals {
  gateway_sa_id = "api-gateway"

  secret_env = {
    discord-proxy     = { DISCORD_PUBLIC_KEY = "discord-public-key" }
    web-auth          = { DISCORD_CLIENT_SECRET = "discord-oauth-client-secret" }
    snapshot-notifier = { SNAPSHOT_WEBHOOK_URL = "discord-snapshot-webhook" }
  }

  admins = {
    ADMIN_USER_IDS = join(",", var.admin_user_ids)
    ADMIN_ROLE_IDS = join(",", var.admin_role_ids)
  }

  functions = {
    discord-proxy = {
      entry_point = "discordProxy", memory = "256Mi", timeout = 10
      env = merge(local.admins, {
        DRAW_TOPIC     = google_pubsub_topic.main["draw-pixel"].name
        COMMANDS_TOPIC = google_pubsub_topic.main["commands"].name
        SNAPSHOT_TOPIC = google_pubsub_topic.main["snapshot-requested"].name
      })
    }
    web-proxy = {
      entry_point = "webProxy", memory = "256Mi", timeout = 15
      env         = { DRAW_TOPIC = google_pubsub_topic.main["draw-pixel"].name }
    }
    web-auth = {
      entry_point = "webAuth", memory = "256Mi", timeout = 15
      env = {
        DISCORD_CLIENT_ID  = var.discord_client_id
        OAUTH_REDIRECT_URI = var.oauth_redirect_uri
        APP_URL            = var.app_url
      }
    }
    draw-pixel = {
      entry_point = "drawPixel", memory = "256Mi", timeout = 60
      env         = {}
    }
    admin-cmd = {
      entry_point = "adminCmd", memory = "256Mi", timeout = 540
      env         = local.admins
    }
    get-canvas = {
      entry_point = "getCanvas", memory = "1Gi", timeout = 300
      env         = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
    }
    snapshot-worker = {
      entry_point = "snapshotWorker", memory = "1Gi", timeout = 540
      env         = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
    }
    snapshot-notifier = {
      entry_point = "snapshotNotifier", memory = "256Mi", timeout = 60
      env         = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
    }
  }
}

data "archive_file" "source" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${path.module}/../../functions/bot/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
  excludes    = ["node_modules", "*.test.js", "fake-firestore.js", "local.js", "Dockerfile", ".dockerignore", "register-commands.js"]
}

resource "google_storage_bucket_object" "source" {
  for_each = local.functions
  name     = "${each.key}/${data.archive_file.source[each.key].output_md5}.zip"
  bucket   = google_storage_bucket.source.name
  source   = data.archive_file.source[each.key].output_path
}

resource "google_service_account" "function" {
  for_each     = merge(local.functions, { "pubsub-push" = {}, (local.gateway_sa_id) = {} })
  account_id   = each.key
  display_name = "pixelwar ${each.key}"
}

resource "google_cloudfunctions2_function" "fn" {
  for_each = local.functions
  name     = each.key
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = each.value.entry_point
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source[each.key].name
      }
    }
  }

  service_config {
    available_memory      = each.value.memory
    timeout_seconds       = each.value.timeout
    service_account_email = google_service_account.function[each.key].email
    ingress_settings      = "ALLOW_ALL"

    environment_variables = merge(each.value.env, {
      GOOGLE_CLOUD_PROJECT = var.project_id
      TRACE_SAMPLE_RATIO   = tostring(var.trace_sample_ratio)
    })

    dynamic "secret_environment_variables" {
      for_each = lookup(local.secret_env, each.key, {})
      content {
        key        = secret_environment_variables.key
        project_id = var.project_id
        secret     = google_secret_manager_secret.secret[secret_environment_variables.value].secret_id
        version    = "latest"
      }
    }
  }

  depends_on = [
    google_project_service.api,
    google_secret_manager_secret_iam_member.read,
    google_project_iam_member.function_base,
  ]
}
