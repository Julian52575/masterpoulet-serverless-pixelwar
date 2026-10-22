# observability (Kubernetes)

Values for the upstream charts that make up the cluster's monitoring, logging and tracing stack.
These are the Kubernetes counterparts of [`observability/compose/`](../../../observability/compose/).

| File | Chart | Role |
|---|---|---|
| `kube-prometheus-stack.yaml` | prometheus-community/kube-prometheus-stack | Prometheus, Alertmanager (+ alert sink), Grafana, node-exporter, kube-state-metrics |
| `loki.yaml` | grafana/loki | Log storage (single binary) |
| `tempo.yaml` | grafana/tempo | Trace storage, service-graph metrics |
| `alloy.yaml` | grafana/alloy | Agent: pod logs and events → Loki, OTLP traces → Tempo |
| `traefik.yaml` | traefik/traefik | Ingress controller with metrics and tracing |
| `versions.env` | — | Pinned chart versions for `just k8s-observability` |

`just k8s-observability` installs them in order; `just k8s-validate` renders and validates them.
