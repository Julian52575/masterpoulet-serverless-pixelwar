# Web contract

**Status: implemented** on the backend side (`web-auth`, `web-proxy`, `draw-pixel`, Firestore rules). This page is what the website needs to talk to it. The detailed reference of each function is [`bot/README.md`](bot/README.md); what the infrastructure must provide is [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md).

The website is the second entry point of Pixelwar, next to the Discord bot. The subject (§3.3, §3.4) requires:

- Discord OAuth2 login, minimal scopes, no user access token stored server side;
- every frontend write authenticated and sent through **the same gateway and event pipeline** as the bot, with no direct writes to storage;
- the same pause and rate limit for `/draw` and web draws;
- chunked loading, pixel inspection (author and time), a brush with a configurable size;
- real-time updates, with no polling.

## 1. Overview

```
                    ┌─► web-auth ──► Discord OAuth2                    (login)
Browser ─► API Gateway
                    └─► web-proxy ──[draw-pixel topic]──► draw-pixel ──► Firestore   (writes)

Browser ◄──── Firebase web SDK, live listeners (read only) ◄──────────── Firestore   (reads, real time)
```

- **Writes** go through the API Gateway to `web-proxy`, which publishes on the same `draw-pixel` topic as Discord's `/draw`. `draw-pixel` applies the same rules to both.
- **Reads** (loading the canvas, pixel inspection, real time, pause) come straight from Firestore through the Firebase web SDK. The security rules allow reading only, never writing.

## 2. Decisions taken

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | One topic for Discord and web draws? | **Yes**, `draw-pixel`, with the types `draw` and `web.draw` | one worker applies pause, rate limit and idempotency to both, so the rules cannot diverge |
| D2 | Session after login | **The Discord access token itself**, kept by the browser and checked by `web-proxy` with Discord (`/users/@me`, cached 5 minutes) | no signing key to manage and no extra service; the server stores no token |
| D3 | Real time | **Firestore live listeners** in the browser | the API Gateway does not proxy WebSockets; listeners give the first load and then only the changes, with no polling and no service to run |
| D4 | Pause and quota answers for web draws | `web-proxy` answers `423` / `429` from a quick read; `draw-pixel` checks again in its transaction and stays the authority | the user gets an immediate answer |
| D5 | Web snapshots and web admin | **Not on the website**: `/snapshot` and `/admin` stay Discord commands, as the subject defines them | admin rights are checked in one place |

## 3. Login (`web-auth`)

1. The "Login with Discord" button is a plain link to `GET /api/auth/login`. It sets a `state` cookie and redirects to Discord with the `identify` scope only.
2. Discord sends the browser to `GET /api/auth/callback?code&state`. `web-auth` checks the `state` (CSRF), exchanges the code with the client secret, reads the user id, and redirects to:
   - success: `<APP_URL>#access_token=<token>&token_type=Bearer&expires_in=<seconds>`
   - failure: `<APP_URL>#auth_error=<access_denied | invalid_state | invalid_code | discord_unavailable>`
3. The website reads the fragment, **removes it from the address bar** (`history.replaceState`), and keeps the token in memory or `sessionStorage` (never `localStorage`, never a cookie it creates). A token lasts about 7 days (`expires_in`).

Logging out is just forgetting the token. On a `401` from a draw, the token expired or was revoked: show the login button again.

## 4. Writes (`web-proxy`)

| Method and path | Body |
|---|---|
| `POST /api/pixels` | `{ "x": 10, "y": 20, "color": "#e50000" }` |
| `POST /api/brush` | `{ "x": 10, "y": 20, "color": "red", "size": 4 }`, a square of `size` 1 to 16 around (x, y), clipped to the grid |

Headers:
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json`
- `X-Correlation-Id: <id>` (optional, 8 to 64 letters, digits, `-` or `_`; the server makes one otherwise and always sends it back in `x-correlation-id`). Show it in an error message so a user can report it: it finds every log of that draw.

`x` and `y` are whole numbers from 0 to 9999. `color` is a palette name or a hex code `#rrggbb`. The body must be under 1 KB. **The author always comes from the token**: an `author` field in the body is ignored.

| Status | Meaning | What the website does |
|---|---|---|
| `202 { "accepted": n }` | queued; `n` pixels fit in the user's quota (a brush may be cut) | nothing: the pixels arrive through the listeners |
| `400 { "error" }` | invalid body | show the error |
| `401` | no token, or Discord refuses it | ask to log in again |
| `423` | drawing is paused | show the pause banner |
| `429 { "limit", "retry_after" }` | quota used up for this minute (also a `Retry-After` header) | show a countdown |
| `503` | Discord could not be reached to check the token (`Retry-After: 5`) | retry later |

`202` means "safely in the queue", not "on the canvas": `draw-pixel` writes it a moment later, and the listeners then show it. The quota (20 pixels per minute by default, changed with `/admin ratelimit`) is **shared with Discord**: it counts pixels, so a brush of size 4 uses 16.

## 5. Reads and real time (Firestore)

Firebase config (`apiKey`, `projectId`, `appId`): given by the infrastructure at build time. The web `apiKey` only names the project, it is not a secret.

**Fixed values** (there is no `/api/config` any more):

| | |
|---|---|
| grid | 10000 × 10000 |
| tile | 256 × 256 (tile id `"<tx>_<ty>"` with `tx = floor(x / 256)`) |
| brush | 1 to 16 |
| palette | `black #000000`, `white #ffffff`, `red #e50000`, `orange #ff9900`, `yellow #ffe600`, `green #02be01`, `blue #0083c7`, `purple #820080` (any `#rrggbb` is also accepted) |

**Listeners:**

1. **State:** `onSnapshot(doc(db, "state", "canvas"))`. `paused` drives the pause banner. When `cleared_at` moves forward, wipe the local canvas and ignore any pixel with `updated_at <= cleared_at` (old pixels are deleted in batches, so `removed` changes may still arrive for a while).
2. **Visible tiles (chunked loading):** for each tile on screen, `onSnapshot(query(collection(db, "pixels"), where("tile", "==", "<tx>_<ty>"), limit(65536)))`. The first callback gives the whole tile; the next ones only `added`, `modified` and `removed` pixels. Stop the listener when the tile leaves the screen, and keep a few dozen at most. The `limit` is required: the rules refuse a query without it.
3. **Pixel inspection:** `getDoc(doc(db, "pixels", "<x>_<y>"))`.
4. After a network cut, the SDK reconnects and replays what was missed by itself.

**A pixel document** `pixels/<x>_<y>`:

| Field | Type | Frontend `Pixel` |
|---|---|---|
| `x`, `y` | number | `x`, `y` |
| `color` | `#rrggbb` | `color` |
| `author_name` | Discord display name, may be `null` | `author` (shown as "by …") |
| `author` | Discord user id | `authorId` (optional) |
| `updated_at` | Timestamp, when it was drawn | `updatedAt` (`.toDate().toISOString()`) |
| `tile`, `written_at` | internal | not needed |

## 6. The event `web-proxy` publishes

One message per request on `draw-pixel`. A pixel is a 1×1 rectangle, so one type covers both routes:

```json
{
  "type": "web.draw",
  "source": "web",
  "user_id": "123456789012345678",
  "username": "alice",
  "rect": { "x0": 8, "y0": 18, "x1": 12, "y1": 22 },
  "color": "#e50000",
  "request_id": "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10",
  "requested_at": "2026-11-05T14:03:11.000Z",
  "correlation_id": "c2b7a1d4-90f1-4c55-8a7e-2d0f5c3b9e61"
}
```

Attributes: `type`, `source`, `correlation_id`, and the W3C `traceparent` (one trace from the gateway to Firestore). `x1` and `y1` are exclusive. `request_id` is always created by the server: `draw-pixel` uses it (`processed/<request_id>_<chunk>`) so a redelivered message never draws or counts twice.

`draw-pixel` then checks the pause and the shared quota, draws at most what the quota allows (row by row), writes in transactions of at most 400 pixels, skips pixels older than what is stored or older than `cleared_at`, and never calls Discord for a web draw.

## 7. Security

- Discord scope `identify` only. The server never stores the access token: `web-proxy` keeps only a SHA-256 hash of it in memory, for 5 minutes.
- The OAuth `client_secret` is in Secret Manager. The `state` cookie is `__Host-`, HttpOnly, Secure, SameSite=Lax.
- The token travels in a URL fragment, which is never sent to a server nor logged.
- The browser can never write to Firestore; it can read one pixel, a tile at a time, and `state/canvas`, nothing else.
- Same origin: the API does not answer CORS preflights, so the website must be served from the same host as `/api`.

## 8. What the current frontend must change

| Now (old `backend/`) | Change to |
|---|---|
| `fetch('/api/config')` | the fixed values of section 5; `paused` from the `state/canvas` listener |
| `fetch('/api/tiles/{tx}/{ty}')` | the tile listener of section 5 |
| `WebSocket('/ws')` and its `pixels.updated` / `canvas.cleared` messages | the listeners of section 5 |
| `fetch('/api/pixels/{x}/{y}')` (inspection) | `getDoc` of section 5 |
| "Author" input, `author` in the body | the "Login with Discord" button and `Authorization: Bearer <token>` |
| `POST /api/snapshots` and `snapshot.ready` | remove (D5): snapshots are taken with `/snapshot` in Discord |
| no handling of `401`, `503` | section 4 |

The old `backend/` (Express, PostgreSQL, RabbitMQ, WebSocket) is no longer part of the target architecture; it is kept only for local work until the website uses the functions.
