mock_provider "google" {}

variables {
  environment = "dev"
}

run "containers_without_premature_runtime_grants" {
  command = plan
  variables {
    inventory_confirmed = true
  }
  assert {
    condition     = length(google_secret_manager_secret.discord) == 4 && length(google_secret_manager_secret_iam_member.grant) == 0
    error_message = "Create only the four containers; do not invent application service accounts or broad grants."
  }
  assert {
    condition     = alltrue([for secret in google_secret_manager_secret.discord : secret.deletion_protection])
    error_message = "Secret containers must remain deletion-protected."
  }
}

run "unverified_inventory_blocks_creation" {
  command = plan
  expect_failures = [
    google_secret_manager_secret.discord["discord-public-key"],
    google_secret_manager_secret.discord["discord-oauth-client-secret"],
    google_secret_manager_secret.discord["discord-snapshot-webhook"],
    google_secret_manager_secret.discord["discord-bot-token"]
  ]
}

run "prod_secret_cannot_be_read_by_dev_runtime" {
  command = plan
  variables {
    environment         = "prod"
    inventory_confirmed = true
    secret_accessors = {
      discord-public-key = ["serviceAccount:discord-proxy@masterpoulet-dev.iam.gserviceaccount.com"]
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.grant["access:discord-public-key:serviceAccount:discord-proxy@masterpoulet-dev.iam.gserviceaccount.com"]]
}

run "bot_token_is_not_for_a_runtime" {
  command = plan
  variables {
    inventory_confirmed = true
    secret_accessors = {
      discord-bot-token = ["serviceAccount:discord-proxy@masterpoulet-dev.iam.gserviceaccount.com"]
    }
  }
  expect_failures = [var.secret_accessors]
}
