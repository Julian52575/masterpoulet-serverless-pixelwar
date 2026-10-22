set dotenv-load := true
set shell := ["bash", "-eu", "-c"]
# Recipes also get their arguments as "$@", so `just gitnexus cypher "MATCH ..."`
# keeps each argument intact. `{{args}}` interpolation is unaffected.
set positional-arguments := true

# CONTAINER_TOOL overrides the choice (CI uses the runner's docker).
tool := env("CONTAINER_TOOL", `command -v podman >/dev/null && echo podman || echo docker`)
compose := tool + " compose"
# compose derives the project name from the directory name
project := lowercase(file_name(justfile_directory()))

# List available recipes
default:
    @just --list
    @echo -e "\nusing '{{tool}}' as a container tool."

#### Container

# podman if present, else docker -- every recipe goes through this

# Start the stack. Pass `-d` to detach (recommended -- see README). Monitoring: `just up -d --profile monitoring`
up *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # --profile is a global compose option and must precede `up`.
    global=(); rest=()
    while (($#)); do
        case "$1" in
            --profile) global+=("$1" "$2"); shift 2 ;;
            --profile=*) global+=("$1"); shift ;;
            *) rest+=("$1"); shift ;;
        esac
    done
    {{compose}} "${global[@]}" up "${rest[@]}"

# Stop the stack, keeping volumes
down *args:
    {{compose}} --profile monitoring down {{args}}

# Stop the stack and delete its built images (`just rm; just up` = clean rebuild).
rm *args:
    #!/usr/bin/env bash
    set -euo pipefail
    {{compose}} --profile monitoring down --remove-orphans {{args}}
    project="$(basename "$PWD" | tr '[:upper:] ' '[:lower:]-')"
    {{tool}} images -q \
        --filter "reference=${project}*" --filter "reference=localhost/${project}*" \
      | sort -u | xargs -r {{tool}} rmi -f || true

# recreate only the game server (image + container), keeping postgres and traefik running.
# Resources/*.txt is embedded at build time (see Puniemu.csproj), and its COPY
# layer doesn't always get invalidated by a plain `--build` here -- --no-cache
# forces a real rebuild so a Resources/ edit actually ships.
reset *args:
    DOCKER_SOCKET=${DOCKER_SOCKET:-/var/run/docker.sock} {{compose}} build --no-cache {{args}}
    DOCKER_SOCKET=${DOCKER_SOCKET:-/var/run/docker.sock} {{compose}} up -d --force-recreate {{args}}

# Like `just rm`, but also delete named volumes -- wipes db data etc.
nuke *args:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "⚠️  Delete containers, images AND volumes for this project? type 'yes': " c
    [[ "$c" == "yes" ]] || { echo "aborted"; exit 1; }
    if ! just database-dump; then
        echo "⚠️⚠️  database-dump FAILED -- the database volume is about to be deleted with no fresh backup!"
        read -p "Type 'yes' to nuke anyway: " confirm
        echo "$confirm"
        if [ "$confirm" != "yes" ]; then
            echo "Aborted."
            exit 1
        fi
    fi
    just rm
    {{tool}} volume prune --force --filter "label=com.docker.compose.project={{project}}"
    echo "done"

# Show container status
ps:
    {{compose}} ps

# Follow logs, optionally for one service: `just logs web`
logs *args:
    {{compose}} logs -f {{args}}

# Run a command in a running service container: `just exec web ls`
exec service *cmd:
    #!/usr/bin/env bash
    set -euo pipefail
    cid="$(just _cid {{service}})"
    [ -n "$cid" ] || { echo "no running container for service '{{service}}'"; exit 1; }
    ti=-i; [ -t 0 ] && ti=-ti
    exec {{tool}} exec $ti "$cid" {{cmd}}

# Open an interactive shell in a service container: `just sh web`
sh service:
    #!/usr/bin/env bash
    set -euo pipefail
    cid="$(just _cid {{service}})"
    [ -n "$cid" ] || { echo "no running container for service '{{service}}'"; exit 1; }
    ti=-i; [ -t 0 ] && ti=-ti
    exec {{tool}} exec $ti "$cid" sh -c 'exec "$(command -v bash || command -v sh)"'

# Detach with Ctrl-C (non-tty services) or ctrl-p ctrl-q; the container keeps running.
# Attach this terminal to a running service's live stdio: `just attach web`
attach service:
    #!/usr/bin/env bash
    set -euo pipefail
    cid="$(just _cid {{service}})"
    [ -n "$cid" ] || { echo "no running container for service '{{service}}'"; exit 1; }
    exec {{tool}} attach --sig-proxy=false "$cid"

# (internal) print the container id for a compose service in this project
_cid service:
    @{{tool}} ps -q --filter "label=com.docker.compose.project.working_dir={{justfile_directory()}}" --filter "label=com.docker.compose.service={{service}}" | head -n1

#### Lint

# Validate the monitoring stack's configs with each tool's own checker (images pinned as in docker-compose.yml)
monitoring-lint:
    #!/usr/bin/env bash
    set -euo pipefail
    {{compose}} --profile monitoring config >/dev/null
    # Repo mounted read-only at /w; each image validates its own config.
    check() { image=$1 entrypoint=$2; shift 2; {{tool}} run --rm -v "$PWD:/w:ro" -w /w --entrypoint "$entrypoint" "$image" "$@"; }
    c=observability/compose
    check quay.io/prometheus/prometheus:v3.15.0 promtool check config --syntax-only $c/prometheus.yml
    check quay.io/prometheus/prometheus:v3.15.0 promtool check rules charts/pixelwar/files/alerts/app.yml charts/pixelwar/files/alerts/host.yml
    check quay.io/prometheus/alertmanager:v0.34.1 amtool check-config $c/alertmanager.yml
    check docker.io/grafana/loki:3.6.16 loki -config.file=$c/loki.yaml -verify-config
    check docker.io/grafana/tempo:2.9.0 /tempo -config.file=$c/tempo.yaml -config.verify=true
    check docker.io/grafana/alloy:v1.21.1 alloy validate $c/alloy.alloy
    for f in charts/pixelwar/files/dashboards/*.json; do python3 -m json.tool "$f" >/dev/null && echo "$f: valid JSON"; done

#### Kubernetes (docs/kubernetes.md)

kind_cluster := "pixelwar"

# Create the local kind cluster (`KIND_EXPERIMENTAL_PROVIDER=podman` is set when podman is the tool)
k8s-cluster:
    {{ if tool == "podman" { "KIND_EXPERIMENTAL_PROVIDER=podman " } else { "" } }}kind create cluster --config deploy/k8s/kind.yaml

# Delete the local kind cluster and all its data
k8s-cluster-delete:
    {{ if tool == "podman" { "KIND_EXPERIMENTAL_PROVIDER=podman " } else { "" } }}kind delete cluster --name {{kind_cluster}}

# Build the production images and load them into kind (tag `dev`, used by values-local.yaml)
k8s-images:
    #!/usr/bin/env bash
    set -euo pipefail
    for svc in backend frontend; do
        img=localhost/pixelwar-$svc:dev
        {{tool}} build -t $img $svc
        # `kind load` cannot unpack podman archives (no platform metadata); import into containerd directly.
        if [ "{{tool}}" = podman ]; then
            for node in $(KIND_EXPERIMENTAL_PROVIDER=podman kind get nodes --name {{kind_cluster}}); do
                podman save $img | podman exec -i "$node" ctr -n k8s.io images import -
            done
        else
            kind load docker-image $img --name {{kind_cluster}}
        fi
    done

# Create the secrets the charts reference, with random passwords (never stored in Git)
k8s-secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    for ns in pixelwar monitoring; do kubectl create namespace $ns --dry-run=client -o yaml | kubectl apply -f -; done
    kubectl -n pixelwar get secret pixelwar-secrets >/dev/null 2>&1 || kubectl -n pixelwar create secret generic pixelwar-secrets \
        --from-literal=postgres-password="$(openssl rand -hex 16)" \
        --from-literal=rabbitmq-password="$(openssl rand -hex 16)" \
        --from-literal=admin-users="${ADMIN_USERS:-}"
    kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1 || kubectl -n monitoring create secret generic grafana-admin \
        --from-literal=admin-user=admin --from-literal=admin-password="$(openssl rand -hex 12)"
    echo "Grafana password: kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d"

# Install or upgrade the observability stack and Traefik (order matters: CRDs first)
k8s-observability:
    #!/usr/bin/env bash
    set -euo pipefail
    source deploy/k8s/observability/versions.env
    v=deploy/k8s/observability
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
    helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
    helm repo add traefik https://traefik.github.io/charts >/dev/null
    helm repo update >/dev/null
    helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack --version "$KPS_VERSION" -n monitoring --create-namespace -f $v/kube-prometheus-stack.yaml --wait --timeout 10m
    helm upgrade --install loki grafana/loki --version "$LOKI_VERSION" -n monitoring -f $v/loki.yaml --wait --timeout 10m
    helm upgrade --install tempo grafana/tempo --version "$TEMPO_VERSION" -n monitoring -f $v/tempo.yaml --wait
    helm upgrade --install alloy grafana/alloy --version "$ALLOY_VERSION" -n monitoring -f $v/alloy.yaml --wait
    helm upgrade --install traefik traefik/traefik --version "$TRAEFIK_VERSION" -n traefik --create-namespace -f $v/traefik.yaml --wait

# Install or upgrade the app: `just k8s-app` (local images) or `just k8s-app -f other-values.yaml`
k8s-app *args:
    helm upgrade --install pixelwar charts/pixelwar -n pixelwar --create-namespace -f deploy/k8s/pixelwar/values-local.yaml --wait --timeout 5m {{args}}

# Everything, from nothing to a running app with observability
k8s-up: k8s-cluster k8s-secrets k8s-observability k8s-images k8s-app

# Offline checks: lint and render the app chart and the observability charts, then validate them against the API schemas
k8s-validate:
    #!/usr/bin/env bash
    set -euo pipefail
    # CRDs (ServiceMonitor, IngressRoute, ...) are checked against the community CRD catalog.
    validate() { kubeconform -strict -summary -ignore-missing-schemas -schema-location default \
        -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{"{{"}}.Group{{"}}"}}/{{"{{"}}.ResourceKind{{"}}"}}_{{"{{"}}.ResourceAPIVersion{{"}}"}}.json'; }
    helm lint charts/pixelwar -f deploy/k8s/pixelwar/values-local.yaml
    helm template pixelwar charts/pixelwar -f deploy/k8s/pixelwar/values-local.yaml | validate
    source deploy/k8s/observability/versions.env
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
    helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
    helm repo add traefik https://traefik.github.io/charts >/dev/null
    helm repo update >/dev/null
    v=deploy/k8s/observability
    # --api-versions: charts that create ServiceMonitors refuse to render without the CRD.
    for chart in prometheus-community/kube-prometheus-stack:$KPS_VERSION grafana/loki:$LOKI_VERSION grafana/tempo:$TEMPO_VERSION grafana/alloy:$ALLOY_VERSION traefik/traefik:$TRAEFIK_VERSION; do
        ref=${chart%%:*} name=${ref##*/}
        echo "== $name"
        helm template "$name" "$ref" --version "${chart##*:}" -n monitoring -f "$v/$name.yaml" \
            --api-versions monitoring.coreos.com/v1 | validate
    done

# Forward the app (8000), Grafana (3001), Prometheus (9090) and Alertmanager (9093) to localhost
k8s-forward:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    kubectl -n traefik port-forward svc/traefik 8000:80 &
    kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3001:80 &
    kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &
    kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093:9093 &
    wait

# Remove the app (keeps PVCs; delete them with `kubectl -n pixelwar delete pvc --all`)
k8s-app-uninstall:
    helm uninstall pixelwar -n pixelwar

#### GitOps (docs/gitops.md)

# Offline checks: lint and render the GitOps chart, then validate the Applications against the Argo CD CRD schemas
argocd-validate:
    #!/usr/bin/env bash
    set -euo pipefail
    helm lint deploy/argocd -f deploy/argocd/envs/local.yaml
    validate() { kubeconform -strict -summary -schema-location default \
        -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{"{{"}}.Group{{"}}"}}/{{"{{"}}.ResourceKind{{"}}"}}_{{"{{"}}.ResourceAPIVersion{{"}}"}}.json' "$@"; }
    validate deploy/argocd/root-local.yaml
    helm template root deploy/argocd -f deploy/argocd/envs/local.yaml | validate
    # Every values file the Applications reference must exist in the repo.
    helm template root deploy/argocd -f deploy/argocd/envs/local.yaml \
      | grep -oE '(\$values/|\.\./\.\./)deploy/[^ ]+\.yaml' | sed -E 's#^(\$values/|\.\./\.\./)##' | sort -u \
      | while read -r f; do test -f "$f" || { echo "missing values file: $f"; exit 1; }; echo "$f: present"; done

# Install Argo CD into the cluster (pinned chart version)
argocd-install:
    helm repo add argo https://argoproj.github.io/argo-helm >/dev/null
    helm upgrade --install argocd argo/argo-cd --version 10.10.5 -n argocd --create-namespace -f deploy/argocd/argocd-values.yaml --wait

# Hand the environment to Argo CD. A branch other than main is for testing a change before merge.
argocd-bootstrap revision="main":
    kubectl apply -f deploy/argocd/root-local.yaml
    kubectl -n argocd patch application root-local --type merge -p '{"spec":{"source":{"targetRevision":"{{revision}}","helm":{"valueFiles":["envs/local.yaml"],"parameters":[{"name":"targetRevision","value":"{{revision}}"}]}}}}'

# List Argo CD applications with their sync and health status
argocd-status:
    kubectl -n argocd get applications -o custom-columns=NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status,REVISION:.status.sync.revision

# Forward the Argo CD UI to http://localhost:8443 and print the initial admin password
argocd-ui:
    @kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo " <- admin password"
    kubectl -n argocd port-forward svc/argocd-server 8443:80

#### GitNexus

# Re-index with GitNexus and regenerate docs/gitnexus/api-links.md (CI fails when it is stale)
gitnexus-docs-generate:
    CONTAINER_TOOL={{tool}} .github/scripts/gitnexus.sh api-links

# Run any GitNexus CLI command in its container: `just gitnexus cypher "MATCH (r:Route) RETURN r.name"`
gitnexus *args:
    CONTAINER_TOOL={{tool}} .github/scripts/gitnexus.sh "$@"

DATABASE_DUMP_FILE := "db_backup_$(date +%Y%m%d_%H%M%S).sql"
# dump the whole database into a .sql file (starts the db container if it is down, stops it again after)
database-dump:
    #!/usr/bin/env bash
    set -euo pipefail
    service="db"
    proj="com.docker.compose.project.working_dir={{justfile_directory()}}"
    svc="com.docker.compose.service=$service"
    pg="$({{tool}} ps -aq --filter "label=$proj" --filter "label=$svc" | head -n1)"
    started=0
    cleanup() { if [[ "$started" == 1 ]]; then echo "stopping $service (it was down before the dump)"; {{tool}} stop "$pg" >/dev/null || true; fi; }
    trap cleanup EXIT
    if [[ -z "$pg" || -z "$({{tool}} ps -q --filter "label=$proj" --filter "label=$svc")" ]]; then
        echo "$service is down -- starting it for the dump"
        started=1
        DOCKER_SOCKET=${DOCKER_SOCKET:-/var/run/docker.sock} {{tool}} compose up -d $service
        for _ in $(seq 1 30); do
            pg="$({{tool}} ps -aq --filter "label=$proj" --filter "label=$svc" | head -n1)"
            if [[ -n "$pg" ]] && {{tool}} exec "$pg" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then break; fi
            sleep 1
        done
    fi
    [[ -n "$pg" ]] || { echo "could not find the $service container" >&2; exit 1; }
    {{tool}} exec "$pg" pg_dumpall -U "${POSTGRES_USER}" > {{DATABASE_DUMP_FILE}}
    echo "Dumped database into {{DATABASE_DUMP_FILE}}"

# cat `$DATABASE_FILE` into the database (starts the db container if it is down, stops it again after)
database-pipe DATABASE_FILE:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! -f "{{DATABASE_FILE}}" ]]; then
        echo "Error: {{DATABASE_FILE}} not found"
        exit 1
    fi
    service="db"
    proj="com.docker.compose.project.working_dir={{justfile_directory()}}"
    svc="com.docker.compose.service=$service"
    pg="$({{tool}} ps -aq --filter "label=$proj" --filter "label=$svc" | head -n1)"
    started=0
    cleanup() { if [[ "$started" == 1 ]]; then echo "stopping $service (it was down before the restore)"; {{tool}} stop "$pg" >/dev/null || true; fi; }
    trap cleanup EXIT
    if [[ -z "$pg" || -z "$({{tool}} ps -q --filter "label=$proj" --filter "label=$svc")" ]]; then
        echo "$service is down -- starting it for the restore"
        started=1
        DOCKER_SOCKET=${DOCKER_SOCKET:-/var/run/docker.sock} {{tool}} compose up -d $service
        for _ in $(seq 1 30); do
            pg="$({{tool}} ps -aq --filter "label=$proj" --filter "label=$svc" | head -n1)"
            if [[ -n "$pg" ]] && {{tool}} exec "$pg" pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then break; fi
            sleep 1
        done
    fi
    [[ -n "$pg" ]] || { echo "could not find the $service container" >&2; exit 1; }
    {{tool}} exec -i "$pg" psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < {{DATABASE_FILE}}
    echo "Piped {{DATABASE_FILE}} into the database"
