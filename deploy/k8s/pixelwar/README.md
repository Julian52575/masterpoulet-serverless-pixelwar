# pixelwar values

Per-environment overrides for the [pixelwar chart](../../../charts/pixelwar/), layered on its `values.yaml`.

| File | Environment |
|---|---|
| `values-local.yaml` | Local kind cluster: images built by `just k8s-images`, never pulled |

A new environment gets a `values-<env>.yaml` with GHCR images pinned to a release tag; promotion is a PR that changes that tag.
