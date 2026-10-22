# envs

One file per environment, applied on top of [`../values.yaml`](../values.yaml) by that environment's root Application.

| File | Root Application | Cluster |
|---|---|---|
| `local.yaml` | `../root-local.yaml` | Local kind cluster |

A new environment needs `envs/<env>.yaml` (`env`, `app.valueFiles`, `destinationServer`), a matching
`deploy/k8s/pixelwar/values-<env>.yaml`, and a `root-<env>.yaml`.
