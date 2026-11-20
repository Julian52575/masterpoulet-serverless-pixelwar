# Functions: the serverless backend

Deploys everything `app/functions/INFRASTRUCTURE.md` lists: the 8 Cloud Functions (zipped from `app/functions/bot/<name>`), Pub/Sub topics, DLQs and push subscriptions, the scheduler, the snapshot bucket and its notification, Firestore (TTL, rules), Firebase web app, secrets, service accounts, IAM and the API Gateway.

```bash
terraform init -reconfigure -backend-config=backends/dev.hcl
terraform plan -var-file=dev.tfvars
```

Before the first apply:
- Set the two environment-specific values as GitHub **variables** on the `dev` and `prod` environments (they are public, not secrets): `DISCORD_CLIENT_ID`, and optionally `APP_URL` (a custom domain; by default `https://<project_id>.web.app`). CI passes them as `TF_VAR_*`.
  ```bash
  gh variable set DISCORD_CLIENT_ID --env dev --body <application id>
  ```
  Locally, export the same `TF_VAR_*` names (see `.env.example`).
- Set the four secret values as GitHub **secrets** on the `dev` and `prod` environments: `DISCORD_PUBLIC_KEY`, `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_SNAPSHOT_WEBHOOK`, `DISCORD_BOT_TOKEN`. CI passes them as `TF_VAR_*` and Terraform writes them to Secret Manager as write-only versions, so they never enter the state or the plan. Locally, export the same `TF_VAR_*` names (see `.env.example`).
- To change a secret value, update it, then bump `secrets_version` (Terraform cannot detect a change to a write-only value). The deployer service account needs `roles/secretmanager.admin` (or `secretVersionAdder`) on the project.
- `OAUTH_REDIRECT_URI` is derived by Terraform from the gateway host (`https://<gateway_host>/api/auth/callback`); the gateway addresses the functions by their predictable Cloud Run URLs, so one apply is enough. Add that URL in the Discord portal after the apply.
- Then follow section 11 of `app/functions/INFRASTRUCTURE.md` (Discord portal).

Not managed here: the old `discord-command` / `pixel-events` resources, which must be deleted by hand.
