# serverless-pixelwar

On linux, the easiest way to run and test the project is through nix.
`just up` starts the compose stack, and traefik which redirects to the frontend, can be access on port ${PROXY_PORT}.

## Resources

See [Contributor.md](CONTRIBUTOR.md) for project conventions.

- [docs/observability.md](docs/observability.md): metrics, logs, traces and alerts, opt-in with `just up -d --profile monitoring` (Grafana on http://localhost:3001)
- [docs/kubernetes.md](docs/kubernetes.md): Helm chart and local Kubernetes cluster (`just k8s-up`)

## Quick start

```bash
cp .env.example .env
nix develop            # optional, see below
just up --detach       # start the whole compose stack (expensive), then open http://localhost:8000
just reset backend     # rebuild the backend service only
just reset frontend    # rebuild the frontend service only
just reset             # reset all
just nuke              # nuke all (save database)
```

Note that the local backend and frontend dev containers are dynamic, so local code changes are automatically replicated.

## Nix flake (optional)

`flake.nix` provides a dev shell with `just`, rootless Podman, `podman-compose` and `passt`. It starts the Podman API socket and exports it as `$DOCKER_SOCK`, so Traefik can discover containers without root. It also creates `.env` from `.env.example` if missing.

CI uses this same shell, so local and CI environments match. If you already have Podman or Docker and `just`, you can skip Nix.

[The one-command install can be found here](https://docs.determinate.systems/determinate-nix/).

## Justfile

**[Install just here](https://github.com/casey/just)** or from your package manager.

Run `just` to list all recipes. It uses `podman` if available, otherwise `docker`.

| Recipe | What it does |
|---|---|
| `just up -d` / `just down` | Start / stop the stack (`just up -d --profile monitoring` adds the observability services; `down` stops both) |
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
browser ──► proxy (Traefik :8000) ──┬─ /           ──► frontend (Vite, :3000)
                                    ├─ /api/*      ──► backend  (Express, :3000)
                                    └─ /ws         ──► backend  (WebSocket)
                                    backend ──► db (Postgres)
                                    backend ──► rabbitmq ──► backend ──► /ws clients
```

| Service | Role | Link to others |
|---|---|---|
| `proxy` | Traefik reverse proxy; dashboard on `:8080` (dev only, no auth) | Reads `traefik.*` labels from the other containers via the Podman/Docker socket and routes to them |
| `frontend` | React page served by the Vite dev server (hot reload) | Catch-all route `/` (lowest priority). Loads `/api/tiles/*`, draws through `/api/pixels` and `/api/brush`, and applies live deltas from `/ws` |
| `backend` | Express API (proxy) + worker: tiles, pixels, brush, PNG export, snapshots, `/admin/*`, WebSocket on `/ws` | Routed on `/api` (prefix stripped by Traefik) and `/ws`. The API validates, checks pause and quota (shared state in `db`), and queues commands on `rabbitmq`; the worker writes `db` and publishes events to a fanout exchange that every instance relays to its WebSocket clients |
| `db` | Postgres 16 | Used by `backend` through Prisma; migrations run on container start |
| `rabbitmq` | Message broker; management UI on `:15672` | Used by `backend` |
| `prometheus`, `alertmanager`, `alert-sink`, `node-exporter` (profile `monitoring`) | Metrics, alert rules and notifications | Scrape `backend:9464`, `proxy:8082`, `rabbitmq:15692`; see [observability](docs/observability.md) |
| `loki`, `tempo`, `alloy`, `grafana` (profile `monitoring`) | Logs, traces, telemetry agent, UI (`127.0.0.1:3001`) | Alloy tails container logs via the socket and receives OTLP traces from `proxy` and `backend` |

## Configuration (`.env`)

Settings live in `.env`, which is git-ignored. Create it with `cp .env.example .env` (the Nix dev shell does this for you if it is missing). `just` and `docker compose` both read it automatically.

| Variable | Used by | Purpose |
|---|---|---|
| `PROXY_PORT`, `PROXY_DASHBOARD_PORT` | `proxy` | Host ports for the app (default `8000`) and the Traefik dashboard (`8080`) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `db`, `backend` | Database credentials; the backend's `DATABASE_URL` is built from them |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `RABBITMQ_HOST`, `RABBITMQ_PORT` | `rabbitmq`, `backend` | Broker credentials and address |
| `RATE_LIMIT` | `backend` | Pixels per minute per user, default `20`; `0` disables limiting and also lifts the brush size cap of 16 (dev only) |
| `ADMIN_USERS` | `backend` | Comma-separated users allowed on `/admin/*` |
| `GRAFANA_PORT`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | `grafana` | Grafana host port (`3001`) and login |
| `PROMETHEUS_PORT`, `PROMETHEUS_RETENTION`, `ALERTMANAGER_PORT` | `prometheus`, `alertmanager` | Host ports and metrics retention (`7d`) |
| `PODMAN_STORAGE_DIR` (optional) | Nix dev shell | Where rootless Podman stores images and containers |
| `PODMAN_NO_SOCKET` (optional) | Nix dev shell | Set to `1` to skip starting the Podman API socket (CI, headless) |

Change the example passwords before exposing the stack anywhere. To add a variable, put it in `.env.example` with a safe placeholder and pass it to the service in `docker-compose.yml`.

## CI

Defined in `.github/workflows/`. Runs on PRs, pushes to `main`, and manually.

- `ci.yml`: dev shell / `nix flake check`, backend and frontend lint + tests, Dockerfile / compose / workflow linting, `npm audit`, a full stack boot test through Traefik, and GitNexus analysis. The `ci-required` job gates merges.
- `ci-sast.yml`: SonarQube Cloud and CodeQL scans (needs the `SONARQUBE_TOKEN` and `SAST_REPORT_TOKEN` secrets).
- `check-conventional-commit-pr-title.yml`: PR titles must follow Conventional Commits.

## CD

- `release-please.yml`: on `main`, maintains a Release PR with the next version and changelog (from Conventional Commits). Merging it tags and publishes a GitHub Release.
- `release-to-ghcr.yml`: when a release is published, builds the `backend` and `frontend` images and pushes them to GitHub Container Registry (`ghcr.io`).
