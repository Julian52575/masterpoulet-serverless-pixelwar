# pixelwar chart

Deploys the pixelwar app to Kubernetes:

- `backend`: Express API + worker (Deployment, probes on `/health`, metrics on `:9464`)
- `frontend`: static React build (Deployment)
- `postgres`, `rabbitmq`: single-replica StatefulSets for dev (`postgres.enabled` / `rabbitmq.enabled`; set `external.*` to use managed services)
- Traefik `IngressRoute` + `Middleware`: `/` → frontend, `/api` → backend (prefix stripped), `/ws` → backend
- `ServiceMonitor`s, `PrometheusRule` and a Grafana dashboard `ConfigMap` (`monitoring.*`)

```bash
just k8s-secrets && just k8s-app      # install / upgrade with deploy/k8s/pixelwar/values-local.yaml
just k8s-validate                     # helm lint + kubeconform
```

All settings are in [`values.yaml`](values.yaml). Secrets are referenced by name (`existingSecret`), never stored here.
Requires the Traefik and Prometheus Operator CRDs. See [docs/kubernetes.md](../../docs/kubernetes.md).
