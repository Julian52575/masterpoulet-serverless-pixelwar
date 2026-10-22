# grafana

Grafana is configured entirely from files, so a fresh volume starts ready to use.

| Folder | Purpose |
|---|---|
| [`provisioning/`](provisioning/) | Datasources and dashboard providers loaded at startup |

Dashboards themselves live in [`charts/pixelwar/files/dashboards/`](../../../charts/pixelwar/files/dashboards/), shared with Kubernetes.
