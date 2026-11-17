locals {
  gateway_sa_id = "api-gateway"


  secret_values = {
    discord-public-key          = var.discord_public_key
    discord-oauth-client-secret = var.discord_oauth_client_secret
    discord-snapshot-webhook    = var.discord_snapshot_webhook
    discord-bot-token           = var.discord_bot_token
  }

  secret_env = {
    discord-proxy     = { DISCORD_PUBLIC_KEY = "discord-public-key" }
    web-auth          = { DISCORD_CLIENT_SECRET = "discord-oauth-client-secret" }
    snapshot-notifier = { SNAPSHOT_WEBHOOK_URL = "discord-snapshot-webhook" }
  }

  admins = {
    ADMIN_USER_IDS = join(",", var.admin_user_ids)
    ADMIN_ROLE_IDS = join(",", var.admin_role_ids)
  }

  # Static on purpose: the names feed the gateway, whose config must not read anything that reads the gateway host.
  function_specs = {
    discord-proxy     = { entry_point = "discordProxy", memory = "256Mi", timeout = 10 }
    web-proxy         = { entry_point = "webProxy", memory = "256Mi", timeout = 15 }
    web-auth          = { entry_point = "webAuth", memory = "256Mi", timeout = 15 }
    draw-pixel        = { entry_point = "drawPixel", memory = "256Mi", timeout = 60 }
    admin-cmd         = { entry_point = "adminCmd", memory = "256Mi", timeout = 540 }
    get-canvas        = { entry_point = "getCanvas", memory = "1Gi", timeout = 300 }
    snapshot-worker   = { entry_point = "snapshotWorker", memory = "1Gi", timeout = 540 }
    snapshot-notifier = { entry_point = "snapshotNotifier", memory = "256Mi", timeout = 60 }
  }

  function_env = {
    discord-proxy = merge(local.admins, {
      DRAW_TOPIC     = google_pubsub_topic.main["draw-pixel"].name
      COMMANDS_TOPIC = google_pubsub_topic.main["commands"].name
      SNAPSHOT_TOPIC = google_pubsub_topic.main["snapshot-requested"].name
    })
    web-proxy = { DRAW_TOPIC = google_pubsub_topic.main["draw-pixel"].name }
    web-auth = {
      DISCORD_CLIENT_ID  = var.discord_client_id
      OAUTH_REDIRECT_URI = "https://${google_api_gateway_gateway.gateway.default_hostname}/api/auth/callback"
      APP_URL            = var.app_url
    }
    admin-cmd         = local.admins
    get-canvas        = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
    snapshot-worker   = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
    snapshot-notifier = { SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name }
  }

  functions = {
    for name, spec in local.function_specs : name => merge(spec, { env = lookup(local.function_env, name, {}) })
  }
}

data "archive_file" "source" {
  for_each    = local.function_specs
  type        = "zip"
  source_dir  = "${path.module}/../../../app/functions/bot/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
  excludes    = ["node_modules", "*.test.js", "fake-firestore.js", "local.js", "Dockerfile", ".dockerignore", "register-commands.js"]
}

resource "google_storage_bucket_object" "source" {
  for_each = local.function_specs
  name     = "${each.key}/${data.archive_file.source[each.key].output_md5}.zip"
  bucket   = google_storage_bucket.source.name
  source   = data.archive_file.source[each.key].output_path
}

resource "google_service_account" "function" {
  for_each     = toset(concat(keys(local.function_specs), ["pubsub-push", local.gateway_sa_id]))
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
    google_artifact_registry_repository.gcf_artifacts,
    google_storage_bucket.gcf_sources,
    google_secret_manager_secret_version.secret,
    google_secret_manager_secret_iam_member.read,
    google_project_iam_member.function_base,
  ]
}
