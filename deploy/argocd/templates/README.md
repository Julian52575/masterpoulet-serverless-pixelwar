# templates

| File | Renders |
|---|---|
| `project.yaml` | AppProject restricting sources (this repo, pinned chart repos) and destination namespaces |
| `observability.yaml` | One Application per upstream chart: chart from its Helm repo, values from this repo (`$values`); sync waves 0–1 |
| `app.yaml` | The pixelwar Application (`charts/pixelwar`), sync wave 2 |
| `alerts.yaml` | `ArgoCDAppUnhealthy` / `ArgoCDAppOutOfSync` PrometheusRule |

This README is excluded from rendering by `../.helmignore`.
