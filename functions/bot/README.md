# Discord bot (C07)

The Discord bot of Pixelwar: four Cloud Functions (2nd gen) that talk to each other only through events.
This page is the reference for running, testing and deploying them.

## Architecture

```
Discord ──HTTPS──► API Gateway ──► discord-proxy ──[discord-command]──► command-worker ──► Firestore
                                                                            │
                                                     [pixel-events] ◄───────┤
                                                                            │
                                                [snapshot-requested] ◄──────┘
                                                          │
                                                          ▼
                                                   snapshot-worker ──► bucket (snapshots/*.png)
                                                                            │ object.finalized (Eventarc)
                                                                            ▼
                                                                    snapshot-notifier ──► Discord
```

1. `discord-proxy` checks the Ed25519 signature, answers Discord within 3 seconds with a deferred reply, then publishes the command.
2. `command-worker` checks admin rights, applies the rules (pause, rate limit, validation) in Firestore transactions, publishes events and edits the Discord reply.
3. `snapshot-worker` renders the canvas as a PNG and stores it in the bucket.
4. `snapshot-notifier` reacts to the new object and sends a signed link to Discord.

Every log line is JSON on stdout (`severity`, `message`, `function`, `timestamp`), and a `correlation_id` created by the proxy follows each command through all four services. In Cloud Logging, filter with `jsonPayload.correlation_id="<id>"`.

## Commands

| Command | Who | Result |
|---|---|---|
| `/draw x y color` | everyone | draws one pixel; `color` is a palette name or a hex code |
| `/get` | everyone | PNG of the current canvas |
| `/snapshot` | admins | timestamped PNG stored in the bucket, signed link posted in the channel |
| `/admin pause` / `/admin resume` | admins | stops / restarts drawing |
| `/admin clear` | admins | clears the canvas |
| `/admin ratelimit user limit` | admins | sets a user's draws per minute (default 20) |

Admin rights are checked in `command-worker`, never only in Discord. Admin replies are ephemeral.

## Services

Each service is an HTTP Cloud Function built with `@google-cloud/functions-framework`. `index.js` registers the function and reads the configuration when it loads; an invalid configuration stops it from loading. `local.js` and the `Dockerfile` are kept for running a service as a plain container.

| Service | Folder | Entry point |
|---|---|---|
| discord-proxy | `discord-proxy/` | `discordProxy` |
| command-worker | `command-worker/` | `commandWorker` |
| draw-pixel | `draw-pixel/` | `drawPixel` |
| admin-cmd | `admin-cmd/` | `adminCmd` |
| get-canvas | `get-canvas/` | `getCanvas` |
| snapshot-worker | `snapshot-worker/` | `snapshotWorker` |
| snapshot-notifier | `snapshot-notifier/` | `snapshotNotifier` |

Deploy from the service folder (the `.gcloudignore` keeps tests and local files out of the upload):

```bash
gcloud functions deploy <name> --gen2 --runtime=nodejs22 --region=<region> \
  --source=. --entry-point=<entry point> --trigger-http --no-allow-unauthenticated \
  --service-account=<service account> --set-env-vars=...
```

Run one locally with `npm start` (listens on port `8080`).

### discord-proxy

| | |
|---|---|
| Trigger | `POST /interactions`, from Discord through the API Gateway |
| Publishes to | `discord-command` (attributes `type`, `correlation_id`) |
| Env | `DISCORD_PUBLIC_KEY` (required, 64 hex chars, **from Secret Manager**), `PUBSUB_TOPIC` (required, e.g. `discord-command`) |
| Needs | `roles/pubsub.publisher` on `discord-command`, `roles/secretmanager.secretAccessor` on the public key secret |

The gateway must forward the request body **unchanged** and the `x-signature-ed25519` and `x-signature-timestamp` headers: the signature is computed on the raw bytes.

`register-commands.js` registers the seven slash commands for one guild. Run it once per Discord application, with `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`. The bot token is only used here, never by the running services.

### command-worker

| | |
|---|---|
| Trigger | Pub/Sub push from `discord-command`, `POST /` |
| Publishes to | `pixel-events` (`pixel.processed`, `canvas.cleared`), `snapshot-requested` (`snapshot.requested`) |
| Env | `PIXEL_EVENTS_TOPIC` (required), `SNAPSHOT_TOPIC` (required), `ADMIN_USER_IDS` and/or `ADMIN_ROLE_IDS` (comma-separated Discord ids; if both are empty every admin command is refused) |
| Needs | `roles/datastore.user`, `roles/pubsub.publisher` on `pixel-events` and `snapshot-requested` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply (no token needed: the interaction token travels in the message) |

### draw-pixel

| | |
|---|---|
| Trigger | Pub/Sub push from `draw-pixel`, `POST /` |
| Handles | `draw` (Discord `/draw`) and `web.draw` (website pixel and brush); any other type answers `400` and goes to the dead-letter topic |
| Publishes to | `pixel-events` (`pixel.processed`, `pixels.processed`) |
| Env | `PIXEL_EVENTS_TOPIC` (required) |
| Needs | `roles/datastore.user`, `roles/pubsub.publisher` on `pixel-events` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply of `/draw` (web draws never call Discord) |

It applies the same rules as before: pause, per-user rate limit shared by Discord and the web, Firestore transactions and idempotency receipts. Several of its files are copies of `command-worker` files; `shared.test.js` fails if a copy drifts. Until the proxy publishes draws to the `draw-pixel` topic, `command-worker` still handles them too.

### admin-cmd

| | |
|---|---|
| Trigger | Pub/Sub push from `discord-command`, through a subscription filtered on admin commands (`hasPrefix(attributes.type, "admin.")`), `POST /` |
| Handles | `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit`; any other type answers `400` and goes to the dead-letter topic |
| Publishes to | `pixel-events` (`canvas.paused`, `canvas.resumed`, `canvas.cleared`) |
| Env | `PIXEL_EVENTS_TOPIC` (required), `ADMIN_USER_IDS` and/or `ADMIN_ROLE_IDS` (comma-separated Discord ids; if both are empty every command is refused) |
| Needs | `roles/datastore.user`, `roles/pubsub.publisher` on `pixel-events` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply |

Every message is checked against the admin allow-list before anything runs: a normal user gets "for administrators only" and nothing is written. Several of its files are copies of `command-worker` files; `shared.test.js` fails if a copy drifts.

### get-canvas

| | |
|---|---|
| Trigger | Pub/Sub push from `discord-command`, through a subscription filtered on `/get` (`attributes.type = "get"`), `POST /` |
| Handles | `get` only, for every user; any other type answers `400` and goes to the dead-letter topic |
| Reads | `state/canvas` and the visible pixels in Firestore |
| Env | none |
| Needs | `roles/datastore.viewer` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply with the PNG attached |

Several of its files are copies of `command-worker` files; `shared.test.js` fails if a copy drifts.

### snapshot-worker

| | |
|---|---|
| Trigger | Pub/Sub push from `snapshot-requested`, `POST /` |
| Writes | `gs://<SNAPSHOT_BUCKET>/snapshots/<ISO time>_<snapshot id>.png`, with the Discord interaction in the object metadata |
| Env | `SNAPSHOT_BUCKET` (required), `STORAGE_API_ENDPOINT` (local emulator only) |
| Needs | `roles/datastore.viewer`; on the bucket, create **and overwrite** objects (`roles/storage.objectUser`, since a retried request writes the same name again) |

### snapshot-notifier

| | |
|---|---|
| Trigger | Eventarc `google.cloud.storage.object.v1.finalized` on the snapshot bucket, `POST /` |
| Env | `SNAPSHOT_BUCKET` (required, other buckets and objects outside `snapshots/` are ignored), `SIGNED_URL_TTL_MINUTES` (default `60`, max `10080`), `STORAGE_API_ENDPOINT` (local emulator only) |
| Needs | `roles/storage.objectViewer` on the bucket, `roles/iam.serviceAccountTokenCreator` **on its own service account** (signing a V4 URL on Cloud Run uses `signBlob`) |

The signed URL and the interaction token are never logged.

## Messaging contract

| Topic | Message `type` | Producer | Consumer |
|---|---|---|---|
| `discord-command` | `draw`, `get`, `snapshot`, `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit` | discord-proxy | command-worker |
| `pixel-events` | `pixel.processed`, `canvas.cleared` | command-worker | the web side (real time) |
| `snapshot-requested` | `snapshot.requested` | command-worker | snapshot-worker |

`pixel.processed` carries `x`, `y`, `tile`, `color`, `author`, `author_name`, `updated_at` and `correlation_id`; its `tile` attribute allows filtered subscriptions. `canvas.cleared` carries `cleared_at` and `cleared_by`.

Push endpoints reply:

| Status | Meaning | Pub/Sub does |
|---|---|---|
| `204` | done, or nothing to do | acks |
| `400` | the message can never succeed | retries until the dead-letter topic |
| `500` | temporary failure (Firestore, Discord 429/5xx) | retries |

Every command is idempotent: a receipt in `processed/{interaction_id}` stops a redelivered draw from counting twice.

## Firestore

| Document | Content |
|---|---|
| `state/canvas` | `paused`, `cleared_at`, `cleared_by`, `updated_by`, `updated_at` |
| `pixels/{x}_{y}` | `x`, `y`, `tile`, `color`, `author`, `author_name`, `updated_at` (grid 10000×10000, tiles of 256) |
| `limits/{user_id}` | per-user draws per minute |
| `ratelimit/{user_id}_{minute}` | fixed-window counter, `expires_at` |
| `processed/{interaction_id}` | idempotency receipt, `expires_at` |

Only single-field indexes are used. TTL policies on `ratelimit.expires_at` and `processed.expires_at` clean old documents.

## Infrastructure checklist

What the Terraform has to provide for the bot:

- Firestore (native mode), with the two TTL policies above.
- Topics `discord-command`, `pixel-events` and `snapshot-requested`, each with a dead-letter topic.
- Push subscriptions `discord-command` → command-worker and `snapshot-requested` → snapshot-worker, authenticated with OIDC (a service account with `roles/run.invoker`), with an ack deadline of about 60 s and a dead-letter policy.
- A private bucket (uniform access, public access prevention) for snapshots.
- An Eventarc trigger on that bucket → snapshot-notifier. The Cloud Storage service agent needs `roles/pubsub.publisher`, and the trigger's service account `roles/run.invoker` and `roles/eventarc.eventReceiver`.
- The secret holding the Discord public key.
- One service account per service, with the roles listed above.
- Four Cloud Functions (2nd gen, HTTP trigger), **not** publicly invokable: discord-proxy is reached only through the API Gateway, the others only by Pub/Sub and Eventarc.
- An API Gateway route `POST /interactions` → discord-proxy. Its URL goes in the Discord portal as *Interactions Endpoint URL*.

## Development

Node 22 or later. In each service folder:

```bash
npm ci
npm test
```

The tests use `node:test` and an in-memory Firestore, so they need no emulator or network. CI runs them for the four services, along with `npm audit` (see `.github/workflows/ci.yml`).

`snapshot-worker` and `snapshot-notifier` keep copies of a few `command-worker` files (`envelope.js`, `png.js`, `render.js`, `logger.js`, `discord.js`, `fake-firestore.js`). Their `shared.test.js` fails if a copy drifts: change the file in `command-worker` and copy it again.
