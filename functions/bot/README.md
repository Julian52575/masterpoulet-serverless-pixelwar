# Discord bot (C07)

The Discord bot of Pixelwar and the website's write path: seven Cloud Functions (2nd gen) that talk to each other only through events.
This page is the reference for running, testing and deploying them.

## Architecture

```
Website ─► API Gateway ─► web-proxy ─────┐
                                         ├──[draw-pixel]──────────► draw-pixel ──► Firestore
                                         │
Discord ─► API Gateway ─► discord-proxy ─┼──[commands]──┬─(admin.*)─► admin-cmd ──► Firestore
                                         │              └─(get)─────► get-canvas ──► Firestore (read)
                                         │
                                         └──[snapshot-requested]──► snapshot-worker ──► bucket (snapshots/*.png)
                                                                    │ object.finalized (Eventarc)
                                                                    ▼
                                                            snapshot-notifier ──► Discord
```

1. `web-proxy` checks the website user's Discord token, the pause and the quota, then publishes `web.draw` on `draw-pixel` and answers `202`.
2. `discord-proxy` checks the Ed25519 signature, answers Discord within 3 seconds with a deferred reply, then publishes the command on one of three topics: `/draw` on `draw-pixel`, `/snapshot` on `snapshot-requested`, everything else on `commands`.
3. `draw-pixel`, `admin-cmd` and `get-canvas` apply the rules (admin rights, pause, rate limit, validation) in Firestore transactions, publish events and edit the Discord reply. `admin-cmd` and `get-canvas` share the `commands` topic through subscriptions filtered on the `type` attribute.
4. `snapshot-worker` renders the canvas as a PNG and stores it in the bucket.
5. `snapshot-notifier` reacts to the new object and sends a signed link to Discord.

Every log line is JSON on stdout (`severity`, `message`, `function`, `timestamp`), and a `correlation_id` created by the proxy follows each command through every service. In Cloud Logging, filter with `jsonPayload.correlation_id="<id>"`.

## Commands

| Command | Who | Result |
|---|---|---|
| `/draw x y color` | everyone | draws one pixel; `color` is a palette name or a hex code |
| `/get` | everyone | PNG of the current canvas |
| `/snapshot` | admins | timestamped PNG stored in the bucket, signed link posted in the channel |
| `/admin pause` / `/admin resume` | admins | stops / restarts drawing |
| `/admin clear` | admins | clears the canvas |
| `/admin ratelimit user limit` | admins | sets a user's draws per minute (default 20) |

Admin rights are checked by the services, never only in Discord: `admin-cmd` for `/admin`, `discord-proxy` for `/snapshot` (its request goes straight to `snapshot-worker`, so the proxy refuses it at once for a non-admin). Admin replies are ephemeral.

## Services

Each service is an HTTP Cloud Function built with `@google-cloud/functions-framework`. `index.js` registers the function and reads the configuration when it loads; an invalid configuration stops it from loading. `local.js` and the `Dockerfile` are kept for running a service as a plain container.

| Service | Folder | Entry point |
|---|---|---|
| discord-proxy | `discord-proxy/` | `discordProxy` |
| draw-pixel | `draw-pixel/` | `drawPixel` |
| admin-cmd | `admin-cmd/` | `adminCmd` |
| get-canvas | `get-canvas/` | `getCanvas` |
| snapshot-worker | `snapshot-worker/` | `snapshotWorker` |
| snapshot-notifier | `snapshot-notifier/` | `snapshotNotifier` |
| web-proxy | `web-proxy/` | `webProxy` |

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
| Publishes to | `draw-pixel` (`draw`), `commands` (`get`, `admin.*`), `snapshot-requested` (`snapshot.requested`); attributes `type` and `correlation_id` (plus `snapshot_id` for snapshots) |
| Env | `DISCORD_PUBLIC_KEY` (required, 64 hex chars, **from Secret Manager**), `DRAW_TOPIC`, `COMMANDS_TOPIC`, `SNAPSHOT_TOPIC` (required, topic names), `ADMIN_USER_IDS` and/or `ADMIN_ROLE_IDS` (comma-separated Discord ids allowed to run `/snapshot`; if both are empty `/snapshot` is refused to everyone) |
| Needs | `roles/pubsub.publisher` on the three topics, `roles/secretmanager.secretAccessor` on the public key secret |

`/snapshot` is turned into the `snapshot.requested` event `snapshot-worker` expects (`snapshot_id` is the interaction id, `requested_at` the time the proxy received it). The roles it checks come from the interaction, which Discord signs, so they cannot be forged.

The gateway must forward the request body **unchanged** and the `x-signature-ed25519` and `x-signature-timestamp` headers: the signature is computed on the raw bytes.

`register-commands.js` registers the seven slash commands for one guild. Run it once per Discord application, with `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`. The bot token is only used here, never by the running services.

### draw-pixel

| | |
|---|---|
| Trigger | Pub/Sub push from `draw-pixel`, `POST /` |
| Handles | `draw` (Discord `/draw`) and `web.draw` (website pixel and brush); any other type answers `400` and goes to the dead-letter topic |
| Publishes to | `pixel-events` (`pixel.processed`, `pixels.processed`) |
| Env | `PIXEL_EVENTS_TOPIC` (required) |
| Needs | `roles/datastore.user`, `roles/pubsub.publisher` on `pixel-events` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply of `/draw` (web draws never call Discord) |

It applies the same rules as before: pause, per-user rate limit shared by Discord and the web, Firestore transactions and idempotency receipts. Some of its files are shared with other services (see *Development*).

### admin-cmd

| | |
|---|---|
| Trigger | Pub/Sub push from `commands`, through a subscription filtered on admin commands (`hasPrefix(attributes.type, "admin.")`), `POST /` |
| Handles | `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit`; any other type answers `400` and goes to the dead-letter topic |
| Publishes to | `pixel-events` (`canvas.paused`, `canvas.resumed`, `canvas.cleared`) |
| Env | `PIXEL_EVENTS_TOPIC` (required), `ADMIN_USER_IDS` and/or `ADMIN_ROLE_IDS` (comma-separated Discord ids; if both are empty every command is refused) |
| Needs | `roles/datastore.user`, `roles/pubsub.publisher` on `pixel-events` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply |

Every message is checked against the admin allow-list before anything runs: a normal user gets "for administrators only" and nothing is written. Some of its files are shared with other services (see *Development*).

### get-canvas

| | |
|---|---|
| Trigger | Pub/Sub push from `commands`, through a subscription filtered on `/get` (`attributes.type = "get"`), `POST /` |
| Handles | `get` only, for every user; any other type answers `400` and goes to the dead-letter topic |
| Reads | `state/canvas` and the visible pixels in Firestore |
| Env | none |
| Needs | `roles/datastore.viewer` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply with the PNG attached |

Some of its files are shared with other services (see *Development*).

### web-proxy

| | |
|---|---|
| Trigger | `POST /pixels` and `POST /brush` (with or without an `/api` prefix), from the website through the API Gateway |
| Auth | `Authorization: Bearer <Discord access token>` (OAuth2, scope `identify`), checked with `GET https://discord.com/api/v10/users/@me`; the answer is cached 5 minutes per token, keyed by a SHA-256 hash of the token |
| Reads | `state/canvas` (pause), `limits/{user_id}` and `ratelimit/{user_id}_{minute}` (quota), never writes |
| Publishes to | `draw-pixel` (`web.draw`, attributes `type`, `source`, `correlation_id`) |
| Env | `DRAW_TOPIC` (required) |
| Needs | `roles/datastore.viewer`, `roles/pubsub.publisher` on `draw-pixel`; outbound HTTPS to `discord.com` |

Bodies: `{ x, y, color }` for `/pixels`, `{ x, y, color, size }` for `/brush` (a square of `size` 1 to 16 around the point, clipped to the grid). `color` is a palette name or a hex code. The author always comes from the token: an `author` field in the body is ignored.

| Status | When |
|---|---|
| `202 { accepted }` | queued; `accepted` is the number of pixels that fit in the remaining quota |
| `400 { error }` | invalid JSON, coordinates, color or size, or a body over 1 KB |
| `401` | missing token, or a token Discord refuses |
| `423` | drawing is paused |
| `429 { limit, retry_after }` | quota used up this minute (also a `Retry-After` header) |
| `503` | Discord could not be reached to check the token |

Every answer carries an `x-correlation-id` header, which is also the `request_id` and `correlation_id` of the published event. The pause and quota checks are a fast answer for the user: `draw-pixel` checks them again in its transaction and stays the authority. The proxy does not answer CORS preflights: the website must be served from the same origin as the API.

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
| `draw-pixel` | `draw`, `web.draw` | discord-proxy, web-proxy | draw-pixel |
| `commands` | `get`, `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit` | discord-proxy | admin-cmd (`hasPrefix(attributes.type, "admin.")`), get-canvas (`attributes.type = "get"`) |
| `pixel-events` | `pixel.processed`, `pixels.processed`, `canvas.paused`, `canvas.resumed`, `canvas.cleared` | draw-pixel, admin-cmd | the web side (real time) |
| `snapshot-requested` | `snapshot.requested` | discord-proxy | snapshot-worker |

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
- Topics `draw-pixel`, `commands`, `pixel-events` and `snapshot-requested`, each with a dead-letter topic.
- Push subscriptions `draw-pixel` → draw-pixel, `commands` → admin-cmd (filter `hasPrefix(attributes.type, "admin.")`), `commands` → get-canvas (filter `attributes.type = "get"`) and `snapshot-requested` → snapshot-worker, authenticated with OIDC (a service account with `roles/run.invoker`), with an ack deadline of about 60 s and a dead-letter policy.
- A private bucket (uniform access, public access prevention) for snapshots.
- An Eventarc trigger on that bucket → snapshot-notifier. The Cloud Storage service agent needs `roles/pubsub.publisher`, and the trigger's service account `roles/run.invoker` and `roles/eventarc.eventReceiver`.
- The secret holding the Discord public key.
- One service account per service, with the roles listed above.
- Seven Cloud Functions (2nd gen, HTTP trigger), **not** publicly invokable: discord-proxy and web-proxy are reached only through the API Gateway, the others only by Pub/Sub and Eventarc.
- An API Gateway route `POST /interactions` → discord-proxy. Its URL goes in the Discord portal as *Interactions Endpoint URL*.
- API Gateway routes `POST /api/pixels` and `POST /api/brush` → web-proxy, forwarding the `Authorization` header. A gateway quota per client is advised: each new token costs one call to Discord.

## Development

Node 22 or later. In each service folder:

```bash
npm ci
npm test
```

The tests use `node:test` and an in-memory Firestore, so they need no emulator or network. CI runs them for every service, along with `npm audit` (see `.github/workflows/ci.yml`).

Each Cloud Function is deployed from its own folder, so code used by several services is copied into each of them (`envelope.js`, `discord.js`, `reply.js`, `state.js`, `pixels.js`, `render.js`, `png.js`, `logger.js`...). The `SHARED` table at the top of each `shared.test.js` lists which services hold the same file; the test fails as soon as two copies differ. Change a shared file in every service that has it.
