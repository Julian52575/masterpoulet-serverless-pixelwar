# argocd

GitOps definition of each environment: an "app of apps" Helm chart that Argo CD renders into one AppProject
and one Application per component (kube-prometheus-stack, Traefik, Loki, Tempo, Alloy, pixelwar).

| Path | Purpose |
|---|---|
| `Chart.yaml`, `values.yaml` | The chart and its defaults: repo URL, tracked revision, upstream chart versions, sync policy |
| [`envs/`](envs/) | One overrides file per environment |
| [`templates/`](templates/) | The AppProject, Applications and Argo CD alerts |
| `root-local.yaml` | Root Application of the `local` environment: the only object applied by hand |
| `argocd-values.yaml` | Values for installing Argo CD itself |

```bash
just argocd-install && just argocd-bootstrap   # install Argo CD, hand the cluster to Git
just argocd-status                             # sync and health per application
just argocd-validate                           # offline lint + schema validation
```

Workflow, promotion and recovery: [docs/gitops.md](../../docs/gitops.md).
