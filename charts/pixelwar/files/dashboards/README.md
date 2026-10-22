# dashboards

Grafana dashboards as JSON. `pixelwar.json` (uid `pixelwar`) is Grafana's home page in Compose: traffic, errors,
latency, queue depth and message age, dead letters, backend resources and error logs.

Datasources are referenced by fixed uids (`prometheus`, `loki`), which both environments provision.
To change a dashboard, edit it in Grafana, export it as JSON (*Share → Export*), and replace the file here.
