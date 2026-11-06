# Web backend contract (proposal)

**Status: draft, to be agreed by the team.** Once accepted, the backend, frontend and Terraform work all follow it.

The website is the second entry point of Pixelwar, next to the Discord bot. The subject (§3.3, §3.4) requires:

- Discord OAuth2 login, minimal scopes, no user access token stored server side;
- every frontend API call authenticated and sent through **the same gateway and event pipeline** as the bot, with no direct writes to storage;
- the same pause and rate limit for `/draw` and web draws;
- chunked loading, pixel inspection (author and time), a brush with a configurable size;
- real-time updates, with no polling.

This proposal reuses what the bot already has (see [`bot/README.md`](bot/README.md)) and **keeps the routes and socket messages the current frontend already uses**, so the frontend mostly needs auth headers added.

## 1. Overview

```
Browser ──► API Gateway (JWT check) ─┬─► web-auth ──► Discord OAuth2
                                     ├─► web-api (reads) ──► Firestore
                                     └─► web-proxy (writes) ──[commands]──► command-worker ──► Firestore
                                                                                  │
Browser ◄──── WebSocket ──── web-realtime ◄──────────────[pixel-events]◄──────────┘
```

| Service | Role | New or existing |
|---|---|---|
| `web-auth` | Discord OAuth2 login, issues the session | new |
| `web-api` | config, tiles, pixel inspection (read only) | new |
| `web-proxy` | validates draws, publishes commands, answers at once | new |
| `command-worker` | applies every draw, from Discord **and** the web | existing, extended |
| `web-realtime` | pushes `pixel-events` to browsers over WebSocket | new |

## 2. Decisions to take

| # | Question | Proposal | Alternative |
|---|---|---|---|
| D1 | One command topic for both entry points? | **Yes.** The same worker then applies pause, rate limit and idempotency to both, as the subject requires. Rename `discord-command` to `canvas-commands` (only `PUBSUB_TOPIC` changes in the proxy) | a separate `web-commands` topic, with the risk of two diverging rule sets |
| D2 | Session after login | **A short-lived JWT** (RS256, 1 hour) signed by `web-auth`, checked by the API Gateway through its JWKS | server-side sessions in Firestore (one more lookup per call) |
| D3 | Real time | **A WebSocket service on Cloud Run** (`web-realtime`), already what the frontend uses (`/ws`) | Firestore live listeners in the browser, which means rewriting the frontend's loading and real-time code |
| D4 | Pause and quota answers for web draws | `web-proxy` answers `423` / `429` from a quick read, while the worker stays the authority | answer `202` always and report refusals over the socket |
| D5 | Web snapshots and web admin | **Out of scope:** admin and `/snapshot` stay Discord commands, as the subject defines them | port the old `/snapshots` and `/admin/*` routes |

⚠️ **To check for D3:** GCP API Gateway does not seem to proxy WebSockets. If confirmed, `/ws` has to be exposed by Cloud Run directly (JWT checked on connect), or through a load balancer. The subject says all public entry points go through an API Gateway, so the team must decide whether this exception is acceptable or whether to choose the Firestore alternative.

## 3. HTTP API

Every route is under `/api` and requires `Authorization: Bearer <jwt>`, except the three `auth` routes.

| Method and path | Service | Body / result |
|---|---|---|
| `GET /api/auth/login` | web-auth | redirects to Discord (scope `identify`, random `state` in a short-lived cookie) |
| `GET /api/auth/callback?code&state` | web-auth | checks `state`, exchanges the code, reads `/users/@me`, **drops the Discord token**, redirects to `/#token=<jwt>` |
| `GET /api/auth/jwks.json` | web-auth | public key the gateway uses to verify the JWT |
| `GET /api/config` | web-api | `{ size: 10000, tile: 256, maxBrush: 16, paused, palette }` |
| `GET /api/tiles/{tx}/{ty}` | web-api | `Pixel[]` for one 256×256 tile (Firestore query on `tile == "tx_ty"`, pixels drawn before `cleared_at` filtered out) |
| `GET /api/pixels/{x}/{y}` | web-api | one `Pixel`, or `404` |
| `POST /api/pixels` | web-proxy | `{ x, y, color }` |
| `POST /api/brush` | web-proxy | `{ x, y, color, size }`, a square centred on (x, y), `size` from 1 to `maxBrush` |

`Pixel` keeps the frontend's current shape, with the Discord id added:

```json
{ "x": 10, "y": 20, "color": "#e50000", "author": "alice", "authorId": "123456789012345678", "updatedAt": "2026-11-05T14:03:11.000Z" }
```

Write answers:

| Status | When |
|---|---|
| `202 { "accepted": n }` | queued; `n` is the number of pixels within the user's remaining quota |
| `400` | invalid coordinates, colour or size |
| `401` | missing or expired session (the gateway answers) |
| `423` | drawing is paused |
| `429` | quota used up for this minute |

**The author always comes from the JWT, never from the body.** The current frontend sends `author`; it must stop and send the token instead.

## 4. Command message

`web-proxy` publishes one message per request on the command topic (D1). A single pixel is a 1×1 rectangle, so one type covers `/pixels` and `/brush`:

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
  "correlation_id": "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10"
}
```

Attributes: `type`, `source`, `correlation_id`. The rectangle is clipped to the grid and `x1`, `y1` are exclusive. The message never lists pixels, so it stays small whatever the brush size.

### What the worker does with `web.draw`

1. Same checks as `/draw`: pause (`state/canvas`), rate limit (`limits/{user_id}`, `ratelimit/{user_id}_{minute}`). **Discord and web share the same counter**, since both use the Discord id.
2. A brush counts one draw per pixel. If the quota is smaller than the area, only the first pixels (row by row) are drawn.
3. Pixels are written in transactions of at most 400 documents (Firestore allows 500), each with a receipt `processed/{request_id}_{chunk}`, so a redelivered message never counts twice.
4. Pixels drawn before `cleared_at`, or older than what is already stored, are skipped, as for `/draw`.
5. No Discord reply: `source: "web"` has no interaction token.

## 5. Events (`pixel-events`)

Existing events stay as they are (`pixel.processed`, `canvas.cleared`). The worker gains:

| Event | When | Payload |
|---|---|---|
| `pixels.processed` | a `web.draw` chunk was written | `{ pixels: [{ x, y, color, author, author_name, updated_at }], tiles: ["0_0"] }` |
| `canvas.paused` / `canvas.resumed` | `/admin pause` / `/admin resume` | `{ by, at }` |

## 6. WebSocket (`/ws`)

`web-realtime` checks the JWT on connect (`/ws?token=<jwt>`), reads `pixel-events` through one subscription per instance, and forwards to every connected browser the messages the frontend already handles:

| Socket message | From |
|---|---|
| `pixels.updated` (list of `Pixel`) | `pixel.processed`, `pixels.processed` |
| `canvas.cleared` | `canvas.cleared` |
| `canvas.paused` / `canvas.resumed` | the new events above |

The frontend already reconnects and reloads its visible tiles after a disconnect, so a missed event costs a reload, never a stale canvas. `snapshot.ready` is no longer sent (D5).

## 7. Security

- Discord scope `identify` only. The access token lives only for the duration of the callback request.
- OAuth `client_secret` and the JWT private key in Secret Manager.
- `state` checked on callback (CSRF). The JWT goes in the URL fragment, which servers and logs never see.
- One service account per service. `web-api` reads Firestore only, `web-proxy` only publishes, and `web-realtime` only subscribes.
- Cloud Run services not publicly invokable, except `web-realtime` if D3 requires it.

## 8. Impact on each part

| Part | Changes |
|---|---|
| Frontend | log-in button and `Authorization` header; stop sending `author`; `?token=` on `/ws`; hide or remove the snapshot button (D5) |
| Bot | `command-worker` handles `web.draw` and publishes the new events; `discord-proxy` topic renamed if D1 is accepted |
| Terraform | the 4 new services, their service accounts, the OAuth secrets, gateway routes with JWT auth, `web-realtime` exposure (D3) |
| Old `backend/` | replaced by these services; keep it for local work only, or remove it |

## 9. Implementation order

1. `web.draw` in `command-worker`, with the new events (no new service, testable now).
2. `web-auth`.
3. `web-api`.
4. `web-proxy`.
5. `web-realtime`.
