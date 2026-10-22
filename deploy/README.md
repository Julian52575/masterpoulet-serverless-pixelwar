# deploy

Deployment configuration, kept separate from the application code and charts.

| Folder | Purpose |
|---|---|
| [`k8s/`](k8s/) | Kubernetes: local cluster, app values per environment, observability chart values |
| [`argocd/`](argocd/) | GitOps: Argo CD Applications that deploy everything under `k8s/` from Git |
