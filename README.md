# serverless-pixelwar

A shared pixel canvas drawn from Discord slash commands and a website. The backend is serverless on Google Cloud (Cloud Functions, Pub/Sub, Firestore, API Gateway), described in [`app/functions/INFRASTRUCTURE.md`](app/functions/INFRASTRUCTURE.md) and deployed with the Terraform in [`infra/`](infra/). The full component and message-flow diagram is in [`docs/architecture.mmd`](docs/architecture.mmd) (Mermaid).

1. [Quick start](#1-quick-start): create the Discord bot and the Google Cloud project, then deploy with the Terraform here.
2. [Developer experience](#2-developer-experience): local stack, tooling, CI/CD.

See [CONTRIBUTOR.md](CONTRIBUTOR.md) for project conventions.

---

# 1. Quick start

This is the bare minimum that Terraform does **not** do for you: a Discord application, a Google Cloud project with billing, a state bucket, and a few values. Everything else (APIs, functions, Pub/Sub, Firestore, gateway, secrets) comes from `terraform apply`.

## 1.1 Prerequisites

- [`gcloud`](https://cloud.google.com/sdk/docs/install), [Terraform](https://developer.hashicorp.com/terraform/install) **>= 1.11** (write-only secrets), Node.js (to register slash commands).
- A Google account that can create a project and link a billing account, and a Discord account that can manage a server.
- On Nix, `nix develop` gives you most tools (Terraform is unfree: `NIXPKGS_ALLOW_UNFREE=1`).

Pick an environment name for your files, for example `myenv`. It is used in `myenv.tfvars` and `backends/myenv.hcl` below.

## 1.2 Create the Discord application

1. Open the [Developer Portal](https://discord.com/developers/applications), **New Application**.
2. *General Information*: copy the **Application ID** and the **Public Key**.
3. *OAuth2*: **Reset Secret** and copy the **Client Secret**.
4. *Bot*: **Reset Token** and copy the **bot token**.
5. In your Discord server, create the channel that receives snapshots, then *Channel settings → Integrations → Webhooks → New Webhook* and copy the **webhook URL**.
6. Optional: enable *User Settings → Advanced → Developer Mode*, then copy your **user id** and the **id of an admin role** (right click → Copy ID). Also copy the **server id**; you need it to register the commands.

Two more portal settings need the gateway address, so they come after the deploy ([step 1.7](#17-finish-in-the-discord-portal)).

## 1.3 Create the Google Cloud project

```bash
gcloud auth login
gcloud auth application-default login      # what Terraform uses (not `gcloud config`)

gcloud projects create <project-id>
gcloud billing accounts list
gcloud billing projects link <project-id> --billing-account=<ACCOUNT_ID>

# Terraform state bucket (must exist before `terraform init`)
gcloud storage buckets create gs://<project-id>-state --project=<project-id> \
  --location=europe-west1 --uniform-bucket-level-access
gcloud storage buckets update gs://<project-id>-state --versioning
```

Your account needs the Owner role on the project. The Compute and other APIs are enabled by Terraform.

## 1.4 Write the Terraform files

Terraform takes the project from the **tfvars** file and the state location from the **backend** file; `gcloud config set project` has no effect. The two stacks must use **different state prefixes**, or one will try to delete the other's resources.

`infra/serverless/functions/myenv.tfvars`:

```hcl
project_id        = "<project-id>"
region            = "europe-west1"
discord_client_id = "<application id>"
app_url           = "https://<your site>/"        # where Discord login sends users back; for tests use http://localhost:5173/
admin_user_ids    = ["<your discord user id>"]    # optional
admin_role_ids    = ["<admin role id>"]           # optional
```

`infra/serverless/functions/backends/myenv.hcl`:

```hcl
bucket = "<project-id>-state"
prefix = "functions/myenv"
```

`scripts/create_tfbackends.py` writes both backend files (functions and foundation) for you, and refuses identical prefixes:

```bash
python3 scripts/create_tfbackends.py                                    # asks for env, bucket and prefixes
python3 scripts/create_tfbackends.py --env myenv --bucket <project-id>-state   # no prompts
```

It asks before overwriting an existing file (`--force` skips the question, `--stack` limits it to one stack), and it does not write the tfvars files or check that the bucket exists.

The `infra/foundation` stack (VPC, subnet, router, NAT) is independent of the functions today; deploy it only if you want the network. It takes `myenv.tfvars` (`project_id`, `network_name`, `subnet_name`, `subnet_cidr`, `gke_pods_cidr`, `gke_services_cidr`, see `dev.tfvars`; the two GKE ranges are required even if you never deploy GKE) and `backends/myenv.hcl` with `prefix = "foundation/myenv"`.

## 1.5 Provide the secrets

The four Discord values are never written to files: pass them as environment variables. Terraform stores them in Secret Manager as write-only versions, so they stay out of the plan and the state.

```bash
export TF_VAR_discord_public_key="<public key>"
export TF_VAR_discord_oauth_client_secret="<client secret>"
export TF_VAR_discord_bot_token="<bot token>"
export TF_VAR_discord_snapshot_webhook="<webhook url>"
```

Placeholders pass validation if you only want to test the deploy, but the Discord features will not work. To change a value later, update the variable and bump `secrets_version` in the tfvars file (Terraform cannot see changes to write-only values).

## 1.6 Deploy

```bash
cd infra/serverless/functions
terraform init -reconfigure -backend-config=backends/myenv.hcl
terraform plan -var-file=myenv.tfvars -out=plan
terraform apply plan
terraform output gateway_host
```

Review the plan's **destroy** count first; on a fresh project it should be 0.

If the first apply fails with `API not enabled yet`, wait a minute and run it again.

If it fails with `Database already exists` (or a `409` for a bucket that already exists), that resource was created outside Terraform's state. Import it, then plan and apply again (a plan made before the import is stale):

```bash
terraform import -var-file=myenv.tfvars google_firestore_database.default "projects/<project-id>/databases/(default)"
terraform import -var-file=myenv.tfvars google_storage_bucket.gcf_sources "gcf-v2-sources-<project-number>-<region>"
```

## 1.7 Finish in the Discord portal

Use the `gateway_host` output:

1. *General Information → Interactions Endpoint URL*: `https://<gateway_host>/interactions`. Discord sends a signed PING when you save; it accepts the URL only if the deploy worked.
2. *OAuth2 → Redirects*: add `https://<gateway_host>/api/auth/callback`.
3. *OAuth2 → URL Generator*: scopes `bot` and `applications.commands`; open the generated URL to invite the bot to your server.
4. Register the slash commands once per server:

   ```bash
   cd app/functions/bot/discord-proxy && npm ci
   DISCORD_APPLICATION_ID=<application id> DISCORD_BOT_TOKEN=<bot token> \
   DISCORD_GUILD_ID=<server id> node register-commands.js
   ```

## 1.8 Deploy the frontend

The website is a static build served by Firebase Hosting at `https://<project-id>.web.app`. It calls the backend through the API Gateway from [step 1.6](#16-deploy).

1. Enable Hosting once (a Terraform root with only the API; it replaces the former bucket and load balancer):

   ```bash
   cd infra/frontend
   terraform init -reconfigure -backend-config=backends/myenv.hcl
   terraform apply -var-file=myenv.tfvars
   terraform output hosting_url
   ```

2. `web-auth` redirects back to `https://<project-id>.web.app` by default (`app_url` in `myenv.tfvars` overrides it for a custom domain). Nothing to do unless you change it.
3. Build and publish. All values are outputs of step 1.6 (the web `apiKey` is not a secret).

   ```bash
   cd app/frontend && npm ci
   F=../../infra/serverless/functions
   VITE_API_BASE=$(terraform -chdir=$F output -raw api_base_url) \
   VITE_FIREBASE_API_KEY=$(terraform -chdir=$F output -raw firebase_web_api_key) \
   VITE_FIREBASE_APP_ID=$(terraform -chdir=$F output -raw firebase_web_app_id) \
   VITE_FIREBASE_PROJECT_ID=<project-id> \
   npm run build
   npx firebase-tools deploy --only hosting --project <project-id>
   ```

Never set `VITE_BYPASS_DISCORD` in a deployed build. From GitHub, the `Terraform Deploy` workflow does step 3 after the `frontend` leg (variables in [step 1.10](#110-deploy-from-github-optional) and [`infra/frontend/README.md`](infra/frontend/README.md)).

## 1.9 Check it works

In your server, try `/draw 10 10 red` and `/get`. The full checklist is in section 12 of [`INFRASTRUCTURE.md`](app/functions/INFRASTRUCTURE.md).

## 1.10 Deploy from GitHub (optional)

The `Terraform Deploy` workflow (`.github/workflows/terraform-deploy.yml`) deploys the `dev` and `prod` environments. It needs, per GitHub environment:

- Workload Identity Federation from GitHub to a deployer service account in your project. Create it once, by hand, with [`infra/bootstrap`](infra/bootstrap/README.md): it also creates the state bucket and prints the `WIF_PROVIDER` and `DEPLOYER_SA` variables to set.
- The Discord values above, as GitHub variables and secrets.
- For the frontend: the deployer service account needs `roles/firebasehosting.admin`; the build values are read from Terraform outputs (`APP_URL` is only for a custom domain).
- `infra/*/dev.tfvars` and `backends/dev.hcl` (and the `prod` ones) pointing at your own projects and buckets.

`scripts/gh_secrets.py` sets everything one by one and shows what is already set:

```bash
python3 scripts/gh_secrets.py              # asks which categories (ci, foundation, functions)
python3 scripts/gh_secrets.py --list       # status only
```

More on the functions stack: [`infra/serverless/functions/README.md`](infra/serverless/functions/README.md); on the network: [`infra/foundation/README.md`](infra/foundation/README.md).

---

# 2. Developer experience

On linux, the easiest way to run and test the project is through nix.
`just up` starts the compose stack, and traefik which redirects to the frontend, can be access on port ${PROXY_PORT}.

## Run locally

```bash
cp .env.example .env
nix develop            # optional, see below
just up --detach       # start the whole compose stack (expensive), then open http://localhost:8000
just reset frontend    # rebuild the frontend service only
just reset             # reset all
just nuke              # nuke all
```

Note that the local frontend dev container is dynamic, so local code changes are automatically replicated.

## Nix flake (optional)

`flake.nix` provides a dev shell with `just`, rootless Podman, `podman-compose` and `passt`. It starts the Podman API socket and exports it as `$DOCKER_SOCK`, so Traefik can discover containers without root. It also creates `.env` from `.env.example` if missing.

CI uses this same shell, so local and CI environments match. If you already have Podman or Docker and `just`, you can skip Nix.

[The one-command install can be found here](https://docs.determinate.systems/determinate-nix/).

## Justfile

**[Install just here](https://github.com/casey/just)** or from your package manager.

Run `just` to list all recipes. It uses `podman` if available, otherwise `docker`.

| Recipe | What it does |
|---|---|
| `just up -d` / `just down` | Start / stop the stack |
| `just rm` | Stop and remove built images and containers (clean rebuild: `just reset`) |
| `just reset` | Rebuild without cache and recreate containers |
| `just nuke` | Delete containers, images **and volumes** (asks first) |
| `just ps` / `just logs [svc]` | Status / follow logs |
| `just sh <svc>` / `just exec <svc> <cmd>` | Shell / command in a service |
| `just attach <svc>` | Attach to a service's output |
| `just database-dump` / `just database-pipe <file>` | Dump / load the database |
| `just gitnexus ...` | Run the GitNexus CLI |
| `just gitnexus-docs-generate` | Regenerate `docs/gitnexus/api-links.md` (CI fails when stale) |

Run `just` to see all available command and their summary.

## Services (Docker Compose)

```
browser ──► proxy (Traefik :8000) ──┬──► frontend (Vite, :3000)
                                    ├──► web-auth (/api/auth)
                                    └──► web-proxy (/api/pixels, /api/brush) ──► Pub/Sub ──► draw-pixel ──► Firestore
```

The local Compose stack runs the complete frontend and serverless backend architecture locally:

| Service | Role | Link to others |
|---|---|---|
| `proxy` | Traefik reverse proxy; dashboard on `:8080` (dev only, no auth) | Routes `/` to frontend, `/api/auth` to web-auth, `/api` to web-proxy |
| `frontend` | React page served by the Vite dev server (hot reload) | Catch-all route `/` (lowest priority), connects to Firestore emulator on `:8088` |
| `web-proxy` | Serverless proxy for web draws (Functions Framework) | Authenticates tokens, checks rate limits in Firestore, publishes to Pub/Sub |
| `web-auth` | Serverless OAuth handler (Functions Framework) | Redirects to Discord OAuth and delivers token via URL fragment |
| `draw-pixel` | Serverless draw worker (Functions Framework) | Receives Pub/Sub push messages and commits pixel transactions to Firestore |
| `firestore` | Local Firestore emulator (Google Cloud SDK) | Provides live Firestore listeners and document storage on `:8088` |
| `pubsub` | Local Pub/Sub emulator (Google Cloud SDK) | Delivers messages from `draw-pixel` topic to the `draw-pixel` worker |
| `pubsub-init` | Init helper | Creates `draw-pixel` topic and push subscription on startup |

## Configuration (`.env`)

Settings live in `.env`, which is git-ignored. Create it with `cp .env.example .env` (the Nix dev shell does this for you if it is missing). `just` and `docker compose` both read it automatically. See [3. Environment variables](#3-environment-variables) for every variable.

To add a variable, put it in `.env.example` with a safe placeholder and pass it to the service in `docker-compose.yml`.

## CI

Defined in `.github/workflows/`. Runs on PRs, pushes to `main`, and manually.

- `ci.yml`: dev shell / `nix flake check`, functions and frontend lint + tests, Dockerfile / compose / workflow linting, `npm audit`, a full stack boot test through Traefik, and GitNexus analysis. The `ci-required` job gates merges.
- `ci-sast.yml`: SonarQube Cloud and CodeQL scans (needs the `SONARQUBE_TOKEN` and `SAST_REPORT_TOKEN` secrets).
- `check-conventional-commit-pr-title.yml`: PR titles must follow Conventional Commits.

## CD

- `release-please.yml`: on `main`, maintains a Release PR with the next version and changelog (from Conventional Commits). Merging it tags and publishes a GitHub Release.
- `release-to-ghcr.yml`: when a release is published, builds the `frontend` image and pushes them to GitHub Container Registry (`ghcr.io`).
- `terraform-deploy.yml`: manual or on release tags; plans or applies `infra/foundation`, `infra/serverless/functions` then `infra/frontend` (plus the Hosting deploy) per environment (the GKE runner stacks `infra/gke` and `infra/runners` are deployed by hand, see `infra/README.md`) (see [1.10](#110-deploy-from-github-optional)).

# 3. Environment variables

Local variables live in `.env` (copy `.env.example`, see [Configuration](#configuration-env)). Compose passes them to the services; the frontend only sees names starting with `VITE_`.

## 3.1 Local stack (`.env`)

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PROXY_PORT` | `3000` | `proxy` | Host port for the app. Must match the port in `APP_URL` and `OAUTH_REDIRECT_URI` |
| `PROXY_DASHBOARD_PORT` | `8080` | `proxy` | Host port for the Traefik dashboard |
| `DOCKER_SOCK` | Docker's socket | `proxy` | Container engine socket for Traefik discovery (rootless Podman: `/run/user/<uid>/podman/podman.sock`) |
| `FIRESTORE_PORT` | `8088` | `firestore`, `frontend` | Host port for the Firestore emulator |
| `PUBSUB_PORT` | `8085` | `pubsub` | Host port for the Pub/Sub emulator |
| `DISCORD_CLIENT_ID` | example app id | `web-auth` | Discord OAuth application id |
| `DISCORD_CLIENT_SECRET` | `local_secret` | `web-auth` | Discord OAuth secret |
| `APP_URL` | `http://localhost:3000/` | `web-auth` | Where the user is sent after login |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` | `web-auth` | OAuth callback; must be registered in the Discord portal |
| `BYPASS_DISCORD` | `true` in `.env.example` | `web-proxy`, `frontend` | **Dev only.** Lets the frontend draw without a Discord login. Requests without a token are accepted as `anonymous` with a fresh user id per draw (so no per-user rate limit); a token, if sent, is still validated. The frontend reads it as `VITE_BYPASS_DISCORD`. Never enable it in a deployed environment |
| `PODMAN_STORAGE_DIR` | | Nix dev shell | Where rootless Podman keeps images and containers |
| `PODMAN_NO_SOCKET` | | Nix dev shell | Set to `1` to skip starting the Podman API socket |

## 3.2 Frontend (`VITE_*`)

| Variable | Purpose |
|---|---|
| `VITE_FIRESTORE_EMULATOR_HOST` | `host:port` of the Firestore emulator; unset in production |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase web config (local placeholders by default) |
| `VITE_BACKEND_URL` | Target of the `/api` proxy for a standalone `npm run dev` |
| `VITE_BYPASS_DISCORD` | `true` skips the client-side login check (set from `BYPASS_DISCORD`) |

## 3.3 Functions and Terraform

Functions get their settings from Terraform in deployed environments (for example `DRAW_TOPIC`, `SNAPSHOT_BUCKET`, `ADMIN_USER_IDS`). Terraform reads the `TF_VAR_*` variables below, which CI takes from the GitHub environment variables and secrets.

| Variable | Purpose |
|---|---|
| `TF_VAR_discord_client_id`, `TF_VAR_app_url` | Discord application id and public site URL (`https://<site host>/`) |
| `TF_VAR_discord_public_key` | Discord interactions public key |
| `TF_VAR_discord_oauth_client_secret` | Discord OAuth secret |
| `TF_VAR_discord_snapshot_webhook` | Webhook that receives canvas snapshots |
| `TF_VAR_discord_bot_token` | Discord bot token |
