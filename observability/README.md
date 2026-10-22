# observability

Configuration of the observability tools for **Docker Compose**.

| Folder | Purpose |
|---|---|
| [`compose/`](compose/) | Prometheus, Alertmanager, Loki, Tempo, Alloy and Grafana configs mounted by `docker-compose.yml` |

The alert rules and dashboard shared with Kubernetes are in [`charts/pixelwar/files/`](../charts/pixelwar/files/).
Overview: [docs/observability.md](../docs/observability.md).
