# dashboards provider

`dashboards.yaml` tells Grafana to load every JSON file in `/var/lib/grafana/dashboards` into the *Pixelwar* folder.
That path is where `docker-compose.yml` mounts [`charts/pixelwar/files/dashboards/`](../../../../../charts/pixelwar/files/dashboards/).
