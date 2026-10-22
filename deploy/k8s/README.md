# k8s

| Path | Purpose |
|---|---|
| `kind.yaml` | Local single-node cluster (`just k8s-cluster`) |
| [`pixelwar/`](pixelwar/) | Values for the [pixelwar chart](../../charts/pixelwar/), one file per environment |
| [`observability/`](observability/) | Values and pinned versions for the upstream observability charts |

Quick start: `just k8s-up`, then `just k8s-forward`. See [docs/kubernetes.md](../../docs/kubernetes.md).
