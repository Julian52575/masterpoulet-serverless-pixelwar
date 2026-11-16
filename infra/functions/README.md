# Functions: the serverless backend

Deploys everything `functions/INFRASTRUCTURE.md` lists: the 8 Cloud Functions (zipped from `functions/bot/<name>`), Pub/Sub topics, DLQs and push subscriptions, the scheduler, the snapshot bucket and its notification, Firestore (TTL, rules), Firebase web app, secrets, service accounts, IAM and the API Gateway.

```bash
terraform init -reconfigure -backend-config=backends/dev.hcl
terraform plan -var-file=dev.tfvars
```

Before the first apply:
- Replace the `CHANGE_ME` values in `dev.tfvars` / `prod.tfvars`.
- Apply once with `-target=google_secret_manager_secret.secret`, then add a value to each secret by hand: functions read `latest` and fail to deploy without a version.
- `oauth_redirect_uri` is a variable (the gateway host depends on the functions). After the first apply, take `gateway_host` from the outputs and set the variable to match.
- Then follow section 11 of `functions/INFRASTRUCTURE.md` (Discord portal).

Not managed here: the old `discord-command` / `pixel-events` resources, which must be deleted by hand.
