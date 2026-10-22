# provisioning

Mounted at `/etc/grafana/provisioning` ([Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)).

| Folder | Loads |
|---|---|
| [`datasources/`](datasources/) | Prometheus, Alertmanager, Loki and Tempo, linked to each other |
| [`dashboards/`](dashboards/) | The provider that reads dashboard JSON files |
