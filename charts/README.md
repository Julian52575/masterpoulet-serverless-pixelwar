# charts

Helm charts owned by this repository.

| Chart | Purpose |
|---|---|
| [`pixelwar/`](pixelwar/) | The application (backend, frontend, dev Postgres and RabbitMQ) and its monitoring objects |

The observability stack itself uses upstream charts, configured in [`deploy/k8s/observability/`](../deploy/k8s/observability/).
