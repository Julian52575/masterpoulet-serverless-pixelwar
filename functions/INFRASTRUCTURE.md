# Pixelwar serverless backend: what the infrastructure must provide

This is the reference for the Terraform and deployment work. It lists every cloud resource the code in `functions/` expects, with the exact names, settings and IAM roles. The code reads names from environment variables, so the names below are suggestions: if you change one, change the matching variable.

Per-function details (behaviour, logs, error codes) are in [`bot/README.md`](bot/README.md). Everything below is per environment (dev and prod).

## 1. Overview

```
Website ─► API Gateway ─┬─► web-auth ──► Discord OAuth2
                        └─► web-proxy ─────┐
                                           ├─[draw-pixel]───────────► draw-pixel ─► Firestore
Discord ─► API Gateway ───► discord-proxy ─┼─[commands]─┬(admin.*)─► admin-cmd  ─► Firestore
                                           │            └(get)─────► get-canvas ─► bucket + Firestore
                                           └─[snapshot-requested]─► snapshot-worker ─► bucket
                          Cloud Scheduler (*/5) ──┘                                     │
                                       bucket notification ─[snapshot-created]─► snapshot-notifier ─► Discord

Website ◄── Firestore listeners (pixels, state/canvas), read only, protected by firestore.rules
```

## 2. APIs to enable

`cloudfunctions`, `run`, `cloudbuild`, `artifactregistry`, `eventarc` (required by 2nd gen functions), `pubsub`, `firestore`, `storage`, `secretmanager`, `cloudscheduler`, `apigateway`, `servicemanagement`, `servicecontrol`, `iamcredentials`, `firebase`, `firebaserules`, `logging`, `cloudtrace`, `telemetry` (traces are sent to the OTLP endpoint `telemetry.googleapis.com`).

## 3. Cloud Functions (2nd gen)

All functions: runtime `nodejs22`, HTTP trigger, **not** publicly invokable (`--no-allow-unauthenticated`), source = the folder below (its `.gcloudignore` keeps tests out), one dedicated service account each (section 8).

| Function | Source | Entry point | Called by | Memory | Timeout |
|---|---|---|---|---|---|
| `discord-proxy` | `functions/bot/discord-proxy` | `discordProxy` | API Gateway | 256 MiB | 10 s |
| `web-proxy` | `functions/bot/web-proxy` | `webProxy` | API Gateway | 256 MiB | 15 s |
| `web-auth` | `functions/bot/web-auth` | `webAuth` | API Gateway | 256 MiB | 15 s |
| `draw-pixel` | `functions/bot/draw-pixel` | `drawPixel` | Pub/Sub push | 256 MiB | 60 s |
| `admin-cmd` | `functions/bot/admin-cmd` | `adminCmd` | Pub/Sub push | 256 MiB | 540 s |
| `get-canvas` | `functions/bot/get-canvas` | `getCanvas` | Pub/Sub push | 1 GiB | 300 s |
| `snapshot-worker` | `functions/bot/snapshot-worker` | `snapshotWorker` | Pub/Sub push | 1 GiB | 540 s |
| `snapshot-notifier` | `functions/bot/snapshot-notifier` | `snapshotNotifier` | Pub/Sub push | 256 MiB | 60 s |

Why these numbers: discord-proxy must answer Discord within 3 s; `/admin clear` deletes every pixel in batches of 400; get-canvas and snapshot-worker decode PNG tiles in memory, and rebuild from all of Firestore when there is no usable snapshot. A function that hits its timeout is retried by Pub/Sub, and every handler is idempotent.

Each function refuses to start when a required variable is missing or invalid, and logs the reason, so a configuration mistake shows up at deploy time.

### Environment variables

| Function | Variable | Value |
|---|---|---|
| discord-proxy | `DISCORD_PUBLIC_KEY` | **secret** `discord-public-key` (64 hex characters, from the Discord portal) |
| | `DRAW_TOPIC` | `draw-pixel` |
| | `COMMANDS_TOPIC` | `commands` |
| | `SNAPSHOT_TOPIC` | `snapshot-requested` |
| | `ADMIN_USER_IDS`, `ADMIN_ROLE_IDS` | comma-separated Discord ids allowed to run `/snapshot` (same values as admin-cmd) |
| web-proxy | `DRAW_TOPIC` | `draw-pixel` |
| web-auth | `DISCORD_CLIENT_ID` | the Discord application id |
| | `DISCORD_CLIENT_SECRET` | **secret** `discord-oauth-client-secret` |
| | `OAUTH_REDIRECT_URI` | `https://<gateway host>/api/auth/callback` (must also be added in the Discord portal, section 11) |
| | `APP_URL` | the website URL, e.g. `https://<site host>/` |
| draw-pixel | | none |
| admin-cmd | `ADMIN_USER_IDS`, `ADMIN_ROLE_IDS` | comma-separated Discord user ids / role ids of the admins; if both are empty, every admin command is refused |
| get-canvas | `SNAPSHOT_BUCKET` | the snapshot bucket name |
| snapshot-worker | `SNAPSHOT_BUCKET` | the snapshot bucket name |
| snapshot-notifier | `SNAPSHOT_BUCKET` | the snapshot bucket name |
| | `SIGNED_URL_TTL_MINUTES` | optional, default `60` (max `10080`) |
| | `SNAPSHOT_WEBHOOK_URL` | optional **secret** `discord-snapshot-webhook`; without it, scheduled snapshots are not posted |
| | `SCHEDULED_POST_EVERY_MINUTES` | optional, default `60` (from `5` to `10080`) |

Every function also takes these tracing variables:

| Variable | Value |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | the project id. **Required for tracing**: 2nd gen functions do not set it; without it the function logs `tracing disabled` and only writes logs |
| `TRACING_ENABLED` | optional; tracing is on by default in the cloud (`K_SERVICE` is set) and off locally; `false` turns it off |
| `TRACE_SAMPLE_RATIO` | optional, from `0` to `1`, default `1` (every request). The decision depends only on the trace id, so all functions keep or drop the same traces |

`STORAGE_API_ENDPOINT` exists only to reach a local storage emulator: do not set it in the cloud.

Secrets are given to the functions as secret environment variables (`secret_environment_variables`, version `latest`), never as plain values.

## 4. Pub/Sub

### Topics

| Topic | Producers | Dead-letter topic |
|---|---|---|
| `draw-pixel` | discord-proxy, web-proxy | `draw-pixel-dlq` |
| `commands` | discord-proxy | `commands-dlq` |
| `snapshot-requested` | discord-proxy, Cloud Scheduler | `snapshot-requested-dlq` |
| `snapshot-created` | the snapshot bucket (notification) | `snapshot-created-dlq` |

Each dead-letter topic needs **a pull subscription** (e.g. `draw-pixel-dlq-sub`, retention 7 days), otherwise the dead messages are dropped and nobody can inspect or replay them.

### Push subscriptions

| Subscription | Topic | Filter | Push endpoint | Ack deadline |
|---|---|---|---|---|
| `draw-pixel` | `draw-pixel` | none | draw-pixel URL | 60 s |
| `admin-cmd` | `commands` | `hasPrefix(attributes.type, "admin.")` | admin-cmd URL | 600 s |
| `get-canvas` | `commands` | `attributes.type = "get"` | get-canvas URL | 300 s |
| `snapshot-worker` | `snapshot-requested` | none | snapshot-worker URL | 600 s |
| `snapshot-notifier` | `snapshot-created` | none | snapshot-notifier URL | 60 s |

For all of them:
- **OIDC authentication**: `push_config.oidc_token` with the service account `pubsub-push` (section 8) and the function URL as audience.
- **Dead-letter policy**: the matching `-dlq` topic, `max_delivery_attempts = 5`.
- **Retry policy**: `minimum_backoff = 10s`, `maximum_backoff = 600s`.
- Message retention: 7 days.

The endpoints answer `204` (done, ack), `400` (can never succeed, so it goes to the DLQ after the retries) or `500` (temporary failure, retried).

A filter cannot be changed after the subscription is created: changing it means recreating the subscription.

**Old resources to delete:** the `discord-command` and `pixel-events` topics, their subscriptions, the `command-worker` function and its service account, and any Eventarc trigger to the notifier.

## 5. Cloud Scheduler

| Setting | Value |
|---|---|
| Job | `snapshot-every-5-minutes` |
| Schedule | `*/5 * * * *`, time zone `Etc/UTC` |
| Target | Pub/Sub topic `snapshot-requested` |
| Data | `{"type":"snapshot.scheduled"}` (base64-encoded in Terraform) |
| Attributes | `type = snapshot.scheduled` |

The message is always the same: the worker takes the snapshot id and time from the Pub/Sub message itself. A run with no change since the previous snapshot writes nothing.

## 6. Cloud Storage: the snapshot bucket

- One private bucket per environment: **uniform bucket-level access**, **public access prevention enforced**, no public ACL. Snapshots are shared only through V4 signed URLs.
- Contents: `tiles/`, `manifests/` and `snapshots/` (see `bot/README.md`).
- **Notification**: `google_storage_notification` → topic `snapshot-created`, `event_types = ["OBJECT_FINALIZE"]`, `object_name_prefix = "snapshots/"`, `payload_format = "JSON_API_V1"` (or `NONE`). The prefix matters: tiles and manifests must not wake the notifier.
- **No lifecycle rule** deleting `tiles/` or `manifests/`: the latest manifest points to old tile objects. If space becomes a problem, only delete tiles older than the oldest manifest kept. Old `snapshots/*.png` can be deleted safely.

## 7. Firestore and Firebase

- Firestore database `(default)` in **native mode** (the Firebase web SDK uses the default database).
- **TTL policies** (`google_firestore_field` with `ttl_config`): collection `ratelimit`, field `expires_at`; collection `processed`, field `expires_at`.
- No composite index: every query uses the automatic single-field indexes.
- **Firebase** enabled on the project (`google_firebase_project`), with a **Web app** (`google_firebase_web_app`). Its `apiKey`, `projectId` and `appId` go into the frontend build; the web `apiKey` only identifies the project, it is not a secret.
- **Security rules**: deploy `functions/firestore/firestore.rules` with `google_firebaserules_ruleset` + `google_firebaserules_release` named `cloud.firestore`. They allow public reads of `pixels` (one tile at a time at most) and `state/canvas`, and nothing else. The functions are not affected (service accounts bypass rules).

## 8. Service accounts and IAM

One service account per function, plus one for Pub/Sub push and one for the gateway. Never use the default compute service account.

| Service account | Roles |
|---|---|
| `discord-proxy` | `roles/pubsub.publisher` on `draw-pixel`, `commands`, `snapshot-requested`; `roles/secretmanager.secretAccessor` on `discord-public-key` |
| `web-proxy` | `roles/pubsub.publisher` on `draw-pixel`; `roles/datastore.viewer` |
| `web-auth` | `roles/secretmanager.secretAccessor` on `discord-oauth-client-secret` (no Firestore, no Pub/Sub) |
| `draw-pixel` | `roles/datastore.user` |
| `admin-cmd` | `roles/datastore.user` |
| `get-canvas` | `roles/datastore.viewer`; `roles/storage.objectViewer` on the bucket |
| `snapshot-worker` | `roles/datastore.viewer`; `roles/storage.objectUser` on the bucket (it overwrites `manifests/latest.json` and rewrites the same objects on a retry) |
| `snapshot-notifier` | `roles/storage.objectViewer` on the bucket; `roles/iam.serviceAccountTokenCreator` **on its own service account** (to sign URLs with `signBlob`); `roles/secretmanager.secretAccessor` on `discord-snapshot-webhook` |
| `pubsub-push` | `roles/run.invoker` on the 5 Pub/Sub-triggered functions |
| `api-gateway` | `roles/run.invoker` on discord-proxy, web-proxy and web-auth |

Google service agents:

| Service agent | Roles |
|---|---|
| Pub/Sub (`service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com`) | `roles/pubsub.publisher` on the 4 `-dlq` topics; `roles/pubsub.subscriber` on the 5 push subscriptions (both needed for dead-lettering); `roles/iam.serviceAccountTokenCreator` on `pubsub-push` (only needed on projects created before April 2021) |
| Cloud Storage (`service-<project number>@gs-project-accounts.iam.gserviceaccount.com`) | `roles/pubsub.publisher` on `snapshot-created` |
| Cloud Scheduler (`service-<project number>@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) | `roles/pubsub.publisher` on `snapshot-requested` |

Every function's service account also needs `roles/logging.logWriter` (logs) and `roles/telemetry.tracesWriter` (*Cloud Telemetry Traces Writer*, to send spans to `telemetry.googleapis.com`). Without the second one, spans are dropped and the function logs `could not export traces`; requests still work.

## 9. Secret Manager

| Secret | Content | Read by |
|---|---|---|
| `discord-public-key` | the application's public key (Discord portal, *General Information*) | discord-proxy |
| `discord-oauth-client-secret` | the OAuth2 client secret (Discord portal, *OAuth2*) | web-auth |
| `discord-snapshot-webhook` | the channel webhook URL (Discord: channel settings → Integrations → Webhooks) | snapshot-notifier |
| `discord-bot-token` | the bot token | nobody at runtime; only a person running `register-commands.js` |

Create the secrets with Terraform but put the **values** in by hand (or from the CI secrets), never in a `.tf` file or in Git. A value created with `echo` has a trailing newline; the functions trim it.

## 10. API Gateway

One API Gateway (OpenAPI 2.0 config). Each route calls its function with `x-google-backend` (`address` = function URL, `jwt_audience` = function URL, `path_translation: APPEND_PATH_TO_ADDRESS`), as the `api-gateway` service account.

| Route | Function | Notes |
|---|---|---|
| `POST /interactions` | discord-proxy | the body must arrive **unchanged** and the `X-Signature-Ed25519` and `X-Signature-Timestamp` headers must be forwarded: the Ed25519 signature is checked on the raw bytes |
| `GET /api/auth/login` | web-auth | the answer is a `302` with `Set-Cookie`: pass both through |
| `GET /api/auth/callback` | web-auth | forward the query string (`code`, `state`) and the `Cookie` header |
| `POST /api/pixels` | web-proxy | the browser's `Authorization` header must reach the function (see below) |
| `POST /api/brush` | web-proxy | same |

With `jwt_audience`, the gateway puts **its own** Google ID token in `Authorization` and moves the browser's header to `X-Forwarded-Authorization`. web-proxy reads `X-Forwarded-Authorization` first and falls back to `Authorization`, so this works as is; do not strip that header.

No authentication is configured on the gateway itself: Discord requests are checked by their signature, website requests by their Discord token (web-proxy) or the OAuth flow (web-auth). A quota per client on `/api/pixels` and `/api/brush` is advised: each new token costs one call to Discord.

The gateway does not handle CORS preflights here: serve the website from the same host as the API (for example a load balancer with the static site and the gateway behind it), or add the CORS settings at that level.

## 11. Discord portal (by hand)

1. *General Information*: copy the public key into the `discord-public-key` secret.
2. *General Information → Interactions Endpoint URL*: `https://<gateway host>/interactions`. Discord sends a signed PING when you save; it only accepts the URL if discord-proxy answers, so deploy it first.
3. *OAuth2 → Redirects*: add exactly the value of `OAUTH_REDIRECT_URI`.
4. Invite the bot (*OAuth2 → URL Generator*, scopes `bot` and `applications.commands`), then register the slash commands once per server: `DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… node functions/bot/discord-proxy/register-commands.js`.
5. In the server: create the snapshot channel webhook, and an admin role whose id goes in `ADMIN_ROLE_IDS`.
6. To share the application with the team: *Teams*, then transfer the app to the team.

## 12. Smoke test after a deploy

| Test | Expected |
|---|---|
| Save the Interactions Endpoint URL in the portal | accepted (PING/PONG works) |
| `/draw 10 10 red` | "Pixel (10, 10) drawn…"; a `pixels/10_10` document exists |
| `/get` | a PNG; the get-canvas log says `source: "snapshot"` once a snapshot exists |
| `/snapshot` as an admin | a signed link in the reply; `/snapshot` as a non-admin is refused at once |
| `/admin pause`, then `/draw` | "Drawing is paused"; then `/admin resume` |
| wait 5 minutes | snapshot-worker logs `snapshot stored` (or `snapshot skipped: nothing changed`) |
| website login | back on the site with `#access_token=…` |
| website draw | `202`, and the pixel appears through the Firestore listener |
| each `-dlq` subscription | empty |
| Trace Explorer, after `/snapshot` | one trace: `discord-proxy interaction` → `publish snapshot-requested` → `snapshot-worker take snapshot` (with its Firestore and Storage calls) → `snapshot-notifier deliver` → the Discord call |
| no log says `could not export traces` or `tracing disabled` | |

Every log line is JSON with a `correlation_id`, a `trace_id` and the Cloud Logging trace fields, so in Cloud Logging you can filter on `jsonPayload.correlation_id="<id>"`, and from a trace in Trace Explorer open its logs directly. The website may send its own id in an `X-Correlation-Id` header (8 to 64 letters, digits, `-` or `_`); web-proxy and web-auth keep it and send it back.
