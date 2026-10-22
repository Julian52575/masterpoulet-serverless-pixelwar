# alerts

Prometheus alerting rules.

| File | Loaded by | Rules |
|---|---|---|
| `app.yml` | Compose and Kubernetes | Backend down, 5xx ratio, latency, queue backlog, dead letters, backend memory |
| `host.yml` | Compose only | Host memory and disk (Kubernetes uses kube-prometheus-stack's node rules) |

Expressions select targets by the `component` label, which both environments set. Validate with `just monitoring-lint` (`promtool check rules`).
Meaning, thresholds and runbooks: [docs/observability.md#alerts](../../../../docs/observability.md#alerts).
