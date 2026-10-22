# compose

Mounted read-only by the services in the `monitoring` profile of `docker-compose.yml`.

| File | Service | Notes |
|---|---|---|
| `prometheus.yml` | prometheus | Static scrape targets, each labelled with `component` |
| `alertmanager.yml` | alertmanager | Routes every alert to the local `alert-sink` webhook |
| `loki.yaml` | loki | Filesystem storage, 7-day retention |
| `tempo.yaml` | tempo | OTLP receiver, 72h retention, service-graph metrics → Prometheus |
| `alloy.alloy` | alloy | Container logs (Podman/Docker socket) → Loki; OTLP traces → Tempo |
| [`grafana/`](grafana/) | grafana | Datasources and dashboard provisioning |

```bash
just up -d --profile monitoring   # start
just monitoring-lint              # validate every file with its tool's own checker
```

A config change needs a restart of the service (`podman compose restart <service>`); Prometheus also reloads on `SIGHUP`.
