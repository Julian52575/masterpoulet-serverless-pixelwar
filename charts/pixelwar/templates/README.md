# templates

One file per component: `backend.yaml`, `frontend.yaml`, `postgres.yaml`, `rabbitmq.yaml`, `ingress.yaml` (Traefik routing),
`monitoring.yaml` (ServiceMonitors, PrometheusRule, dashboard ConfigMap). Shared labels and helpers are in `_helpers.tpl`.

This README is excluded from rendering by the chart's `.helmignore`.
