# datasources

`datasources.yaml` defines Prometheus (default), Alertmanager, Loki and Tempo with fixed uids, so dashboards work in both environments.

The links between them are what make investigation quick:
- Loki → Tempo: `trace_id` in a log line becomes a link to the trace.
- Tempo → Loki: *Logs for this span* filters logs by the trace id.
- Tempo → Prometheus: the service map is built from span metrics.

Kubernetes defines the same datasources in `deploy/k8s/observability/kube-prometheus-stack.yaml`.
