# files

Observability configuration **shared by Docker Compose and Kubernetes**, so both environments alert and graph the same way.

| Folder | Compose | Kubernetes |
|---|---|---|
| [`alerts/`](alerts/) | Mounted as Prometheus rule files | `app.yml` embedded in a `PrometheusRule` |
| [`dashboards/`](dashboards/) | Provisioned into Grafana | Shipped in a `ConfigMap` picked up by the Grafana sidecar |

Edit here, test with `just up -d --profile monitoring`, then merge: Argo CD delivers the change to the cluster.
