# Discord bot (C07)

The Discord bot of Pixelwar and the website's write path: eight Cloud Functions (2nd gen) that talk to each other only through events.
This page is the reference for running, testing and deploying them.

## Architecture

```
Website ─► API Gateway ─► web-auth ──► Discord OAuth2 (login, code exchange)
Website ─► API Gateway ─► web-proxy ─────┐
                                         ├──[draw-pixel]──────────► draw-pixel ──► Firestore
                                         │
Discord ─► API Gateway ─► discord-proxy ─┼──[commands]──┬─(admin.*)─► admin-cmd ──► Firestore
                                         │              └─(get)─────► get-canvas ──► bucket + Firestore (read)
                                         │
                                         └──[snapshot-requested]──► snapshot-worker ──► bucket (tiles, manifest, overview)
                                                 ▲                  │ [snapshot-created] (OnObjectCreated)
               Cloud Scheduler (every 5 min) ────┘                  ▼
                                                            snapshot-notifier ──► Discord
```

1. `web-auth` logs the website user in with Discord OAuth2 and hands the Discord access token to the browser.
2. `web-proxy` checks the website user's Discord token, the pause and the quota, then publishes `web.draw` on `draw-pixel` and answers `202`.
3. `discord-proxy` checks the Ed25519 signature, answers Discord within 3 seconds with a deferred reply, then publishes the command on one of three topics: `/draw` on `draw-pixel`, `/snapshot` on `snapshot-requested`, everything else on `commands`.
4. `draw-pixel`, `admin-cmd` and `get-canvas` apply the rules (admin rights, pause, rate limit, validation) in Firestore transactions, publish events and edit the Discord reply. `admin-cmd` and `get-canvas` share the `commands` topic through subscriptions filtered on the `type` attribute.
5. `snapshot-worker` renders the canvas as a PNG and stores it in the bucket.
6. `snapshot-notifier` receives the bucket's Pub/Sub notification for the new overview image and sends a signed link to Discord.

Every log line is JSON on stdout (`severity`, `message`, `function`, `timestamp`), and a `correlation_id` created by the proxy follows each command through every service. In Cloud Logging, filter with `jsonPayload.correlation_id="<id>"`.

### Tracing

Every function sends OpenTelemetry spans to Cloud Trace (`tracing.js`, the same file in every function):

- the proxies open a span per request, and each publish opens a `publish <topic>` span whose W3C `traceparent` is added to the Pub/Sub message attributes;
- each worker continues that trace from the message attributes, so one Discord command or web draw is **one trace** across functions;
- `snapshot-worker` stores the `traceparent` in the snapshot's object metadata, and `snapshot-notifier` continues it from there, through the bucket notification;
- Firestore calls and outgoing `fetch` calls (Discord, Cloud Storage) appear as child spans automatically;
- inside a span, every log line also has `trace_id`, `span_id` and the Cloud Logging trace fields, so Trace Explorer links each trace to its logs.

Spans are sent before the function answers, because Cloud Functions slow the CPU down once the answer is sent. Settings and IAM: see [INFRASTRUCTURE.md](../INFRASTRUCTURE.md).

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
| web-auth | `web-auth/` | `webAuth` |

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
| Publishes to | nothing: the website sees new pixels through its Firestore listeners |
| Env | none |
| Needs | `roles/datastore.user` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply of `/draw` (web draws never call Discord) |

It applies the same rules as before: pause, per-user rate limit shared by Discord and the web, Firestore transactions and idempotency receipts. Some of its files are shared with other services (see *Development*).

### admin-cmd

| | |
|---|---|
| Trigger | Pub/Sub push from `commands`, through a subscription filtered on admin commands (`hasPrefix(attributes.type, "admin.")`), `POST /` |
| Handles | `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit`; any other type answers `400` and goes to the dead-letter topic |
| Publishes to | nothing: the website sees `paused` and `cleared_at` through its listener on `state/canvas` |
| Env | `ADMIN_USER_IDS` and/or `ADMIN_ROLE_IDS` (comma-separated Discord ids; if both are empty every command is refused) |
| Needs | `roles/datastore.user` |
| Calls | `https://discord.com/api/v10` to edit the deferred reply |

Every message is checked against the admin allow-list before anything runs: a normal user gets "for administrators only" and nothing is written. Some of its files are shared with other services (see *Development*).

### get-canvas

| | |
|---|---|
| Trigger | Pub/Sub push from `commands`, through a subscription filtered on `/get` (`attributes.type = "get"`), `POST /` |
| Handles | `get` only, for every user; any other type answers `400` and goes to the dead-letter topic |
| Reads | `manifests/latest.json` and its tiles in the snapshot bucket, then `state/canvas` and only the pixels written since that snapshot in Firestore |
| Env | `SNAPSHOT_BUCKET` (required, the same bucket as snapshot-worker), `STORAGE_API_ENDPOINT` (local emulator only) |
| Needs | `roles/datastore.viewer`, `roles/storage.objectViewer` on the snapshot bucket (it never writes) |
| Calls | `https://discord.com/api/v10` to edit the deferred reply with the PNG attached |

Some of its files are shared with other services (see *Development*).

`/get` no longer reads the whole canvas: it starts from the latest snapshot (task 9, refreshed every 5 minutes by the scheduler) and paints on its tiles only the pixels with `written_at` after that snapshot, with the same 2-minute margin. The logic is in `compose.js`, shared with snapshot-worker. It falls back to reading every visible pixel from Firestore when there is no snapshot yet, when the canvas was cleared after the latest snapshot, or when a tile is missing. Each `/get` logs `source` (`snapshot` or `firestore`), `pixels_read` and `changed_tiles`. The image is cropped to the painted tiles, so the area in the reply is given in whole tiles.

### web-proxy

| | |
|---|---|
| Trigger | `POST /pixels` and `POST /brush` (with or without an `/api` prefix), from the website through the API Gateway |
| Auth | `Authorization: Bearer <Discord access token>` (OAuth2, scope `identify`; read from `X-Forwarded-Authorization` first, where the API Gateway moves it), checked with `GET https://discord.com/api/v10/users/@me`; the answer is cached 5 minutes per token, keyed by a SHA-256 hash of the token |
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

Every answer carries an `x-correlation-id` header, which is also the `correlation_id` of the published event. The website may send its own in an `X-Correlation-Id` request header (8 to 64 letters, digits, `-` or `_`; anything else is replaced). The event's `request_id`, which `draw-pixel` uses to drop duplicates, is always a new UUID created by the proxy, never the browser's id. The pause and quota checks are a fast answer for the user: `draw-pixel` checks them again in its transaction and stays the authority. The proxy does not answer CORS preflights: the website must be served from the same origin as the API.

### web-auth

| | |
|---|---|
| Trigger | `GET /auth/login` and `GET /auth/callback` (with or without an `/api` prefix), from the browser through the API Gateway |
| Env | `DISCORD_CLIENT_ID` (required, the application id), `DISCORD_CLIENT_SECRET` (required, **from Secret Manager**), `OAUTH_REDIRECT_URI` (required, https, e.g. `https://<host>/api/auth/callback`, also registered in the Discord portal under *OAuth2 → Redirects*), `APP_URL` (required, https, where the browser is sent back) |
| Needs | `roles/secretmanager.secretAccessor` on the client secret; outbound HTTPS to `discord.com`; nothing in Firestore or Pub/Sub |

The authorization code flow, as the subject describes it:

1. The "Login with Discord" button opens `/api/auth/login`. It sets a random `state` in a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax, 10 minutes) and redirects to Discord with the `identify` scope only.
2. Discord sends the browser back to `/api/auth/callback?code&state`. The `state` must match the cookie (CSRF protection), otherwise Discord is not called.
3. The code is exchanged for an access token with the client secret (HTTP Basic, server side only), and `/users/@me` gives the Discord user id.
4. The browser is redirected to `APP_URL#access_token=…&token_type=Bearer&expires_in=…`. A fragment is never sent to a server and never logged. The token is not stored anywhere on the server side.

The website keeps the token in memory (or `sessionStorage`) and sends it as `Authorization: Bearer <token>` to `web-proxy`. On failure the browser comes back with `#auth_error=access_denied`, `invalid_state`, `invalid_code` or `discord_unavailable`. Every answer has `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and an `x-correlation-id` header, also written on each log line. The login and the callback are two separate browser navigations, so each has its own correlation id; the user id in the `discord login` log links them to the user's later draws.

### snapshot-worker

| | |
|---|---|
| Trigger | Pub/Sub push from `snapshot-requested`, `POST /`: `snapshot.requested` from discord-proxy, `snapshot.scheduled` from Cloud Scheduler |
| Reads | `state/canvas` (`cleared_at`) and `pixels` in Firestore; the latest manifest and the tiles it needs in the bucket |
| Writes | the changed tiles, a manifest and the overview image (see below) |
| Env | `SNAPSHOT_BUCKET` (required), `STORAGE_API_ENDPOINT` (local emulator only) |
| Needs | `roles/datastore.viewer`; on the bucket, read, create **and overwrite** objects (`roles/storage.objectUser`, since a retried request and `manifests/latest.json` overwrite objects) |

Snapshots are **incremental and tiled**. A full 10000×10000 image would not fit in a function's memory, so the canvas is stored as 256×256 tiles (40×40 tiles), and each snapshot only redraws the tiles that changed since the previous one:

1. Read `manifests/latest.json`, the previous snapshot.
2. Read from Firestore only the pixels with `written_at` after the previous snapshot's `taken_at`, minus a 2-minute margin so a write still in a transaction is not missed.
3. For each tile those pixels touch: load the previous tile PNG, paint the new pixels on it, save it as a new object. Unchanged tiles are not read nor copied: the new manifest points to the previous objects.
4. Save the manifest, then the overview image (cropped to the painted tiles, scaled down to 2048 px at most).

The first snapshot, a snapshot after `/admin clear` (the manifest remembers `cleared_at`), or one whose previous tiles are missing reads every visible pixel instead (`mode: "full"`).

| Object | Content |
|---|---|
| `tiles/<tx>_<ty>/<ISO time>_<id>.png` | one 256×256 RGBA tile; transparent = never painted. Never overwritten by another snapshot |
| `manifests/<ISO time>_<id>.json` | `version`, `snapshot_id`, `requested_at`, `taken_at`, `cleared_at`, `previous`, `mode`, `pixel_count`, `changed_tiles`, `image`, and `tiles`: `{ "<tx>_<ty>": { "object", "pixels" } }` |
| `manifests/latest.json` | a copy of the newest manifest |
| `snapshots/<ISO time>_<id>.png` | the overview image, written **last**; its metadata (interaction token, `pixel_count`, `manifest`) is what snapshot-notifier uses |

**Scheduled snapshots.** A Cloud Scheduler job publishes `{"type":"snapshot.scheduled"}` on `snapshot-requested` every 5 minutes. The message is always the same, so the snapshot id and time come from the Pub/Sub message itself: `scheduled-<messageId>` and its `publishTime` (a retried delivery keeps both, so it rewrites the same objects). When nothing was written since the previous snapshot, a scheduled run writes nothing and only logs `snapshot skipped: nothing changed`; the first run, a run after `/admin clear`, and every `/snapshot` from Discord always produce a snapshot. A scheduled overview has `requested_by: "scheduler"` and no interaction token, so snapshot-notifier posts nothing for it.

Tiles still referenced by a manifest must not be deleted: a lifecycle rule may only remove `tiles/` objects older than the oldest manifest kept. A missing tile is not fatal: the worker logs a warning and rebuilds from Firestore.

### snapshot-notifier

| | |
|---|---|
| Trigger | Pub/Sub push from `snapshot-created`, the topic the snapshot bucket notifies on each new object (`OBJECT_FINALIZE`), `POST /`. An Eventarc `google.cloud.storage.object.v1.finalized` CloudEvent is still accepted |
| Env | `SNAPSHOT_BUCKET` (required, other buckets and objects outside `snapshots/` are ignored), `SIGNED_URL_TTL_MINUTES` (default `60`, max `10080`), `SNAPSHOT_WEBHOOK_URL` (optional, a Discord channel webhook, **from Secret Manager**), `SCHEDULED_POST_EVERY_MINUTES` (default `60`, from `5` to `10080`), `STORAGE_API_ENDPOINT` (local emulator only) |
| Needs | `roles/storage.objectViewer` on the bucket, `roles/iam.serviceAccountTokenCreator` **on its own service account** (signing a V4 URL on Cloud Run uses `signBlob`) |

The signed URL and the interaction token are never logged.

A Cloud Storage notification carries the object in its attributes (`eventType`, `bucketId`, `objectId`), so any payload format works (`JSON_API_V1` or `NONE`). Only `OBJECT_FINALIZE` events for `snapshots/*.png` in `SNAPSHOT_BUCKET` do something; everything else (tiles, manifests, deletions, other buckets) is acked and ignored, and a malformed message answers `400` so it ends in the dead-letter topic. A redelivered notification edits the same Discord message again with a new link, which is harmless.

**Scheduled snapshots** (`requested_by: "scheduler"`, no interaction token) are posted in a channel through `SNAPSHOT_WEBHOOK_URL`: a webhook can only post in its own channel, so it gives far less power than the bot token. To keep the channel readable, only the **first scheduled snapshot of each `SCHEDULED_POST_EVERY_MINUTES` period** is posted (by default, at most one per clock hour); the others are stored but not announced. The notifier finds the previous scheduled snapshot by following the manifests' `previous` links (a Discord `/snapshot` in between does not count). Since a scheduled run that sees no change is skipped, an hour without drawing posts nothing. Without a webhook nothing is posted. A webhook post cannot be made idempotent, so in the rare case where Pub/Sub redelivers after a successful post, the channel gets the link twice. The webhook URL contains its token and is never logged.

## Messaging contract

| Topic | Message `type` | Producer | Consumer |
|---|---|---|---|
| `draw-pixel` | `draw`, `web.draw` | discord-proxy, web-proxy | draw-pixel |
| `commands` | `get`, `admin.pause`, `admin.resume`, `admin.clear`, `admin.ratelimit` | discord-proxy | admin-cmd (`hasPrefix(attributes.type, "admin.")`), get-canvas (`attributes.type = "get"`) |
| `snapshot-requested` | `snapshot.requested`, `snapshot.scheduled` | discord-proxy, Cloud Scheduler | snapshot-worker |
| `snapshot-created` | Cloud Storage notification `OBJECT_FINALIZE` (attributes `bucketId`, `objectId`) | the snapshot bucket | snapshot-notifier |

There is no `pixel-events` topic any more: real time for the website comes from Firestore listeners (see *Firestore*), so the workers write to Firestore and publish nothing.

Push endpoints reply:

| Status | Meaning | Pub/Sub does |
|---|---|---|
| `204` | done, or nothing to do | acks |
| `400` | the message can never succeed | retries until the dead-letter topic |
| `500` | temporary failure (Firestore, Discord 429/5xx) | retries |

Every command is idempotent: a receipt in `processed/{interaction_id}` stops a redelivered draw from counting twice.

## Firestore

| Document | Content | Website |
|---|---|---|
| `state/canvas` | `paused`, `cleared_at`, `cleared_by`, `updated_by`, `updated_at` | read, live |
| `pixels/{x}_{y}` | `x`, `y`, `tile` (`"<tx>_<ty>"`), `color` (`#rrggbb`), `author` (Discord id), `author_name`, `updated_at` (when it was drawn), `written_at` (when draw-pixel stored it) (grid 10000×10000, tiles of 256) | read, live |
| `limits/{user_id}` | per-user draws per minute | hidden |
| `ratelimit/{user_id}_{minute}` | fixed-window counter, `expires_at` | hidden |
| `processed/{interaction_id}` | idempotency receipt, `expires_at` | hidden |

Only single-field indexes are used (including `pixels.tile` and `pixels.written_at`, created automatically). TTL policies on `ratelimit.expires_at` and `processed.expires_at` clean old documents.

### Real time for the website (Firestore listeners)

The website gets live updates by **listening to Firestore** with the Firebase web SDK, as on the team diagram ("event streaming on NoSQL data"): no polling, no WebSocket service, and only changed pixels are sent after the first load. All writes still go through `web-proxy` → `draw-pixel`; the browser can never write.

1. `onSnapshot(doc(db, "state", "canvas"))`: show the pause banner from `paused`; when `cleared_at` moves forward, wipe the local canvas and ignore any pixel with `updated_at <= cleared_at` (admin-cmd deletes them in batches, so `removed` changes may still arrive for a while).
2. For each **visible tile**: `onSnapshot(query(collection(db, "pixels"), where("tile", "==", "<tx>_<ty>"), limit(65536)))`. The first callback gives the whole tile (chunked loading); the next ones only the `added`, `modified` and `removed` pixels. Stop the listener when the tile leaves the screen, and keep at most a few dozen listeners.
3. Pixel inspection: `getDoc(doc(db, "pixels", "<x>_<y>"))` gives the color, `author_name`, `author` and `updated_at`.
4. After a network cut the SDK reconnects and replays what was missed by itself.

The security rules are in [`../firestore/firestore.rules`](../firestore/firestore.rules):

- `pixels/*`: anyone may read one pixel, or **list with a `limit` of at most 65536** (one full tile), so nobody can stream the whole 10000×10000 canvas in one query.
- `state/canvas`: anyone may read it.
- everything else (`limits`, `ratelimit`, `processed`, ...): no access at all.
- no write from a browser, anywhere. The functions use service accounts, which are not subject to these rules.

To test them, with Java and the Firebase CLI installed: `firebase emulators:start --only firestore` with this file, then try the queries above (allowed) and a write, a `list` without limit, or a read of `limits/1` (refused).

## Infrastructure checklist

Everything the Terraform has to provide (functions, environment variables, topics and subscriptions, scheduler, bucket, Firestore and Firebase, service accounts and IAM, secrets, API Gateway, Discord portal, smoke test) is in [`../INFRASTRUCTURE.md`](../INFRASTRUCTURE.md).

## Development

Node 22 or later. In each service folder:

```bash
npm ci
npm test
```

The tests use `node:test` and an in-memory Firestore, so they need no emulator or network. CI runs them for every service, along with `npm audit` (see `.github/workflows/ci.yml`).

Each Cloud Function is deployed from its own folder, so code used by several services is copied into each of them (`envelope.js`, `discord.js`, `reply.js`, `state.js`, `pixels.js`, `render.js`, `png.js`, `logger.js`...). The `SHARED` table at the top of each `shared.test.js` lists which services hold the same file; the test fails as soon as two copies differ. Change a shared file in every service that has it.
