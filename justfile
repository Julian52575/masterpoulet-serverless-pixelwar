set dotenv-load := true
set shell := ["bash", "-eu", "-c"]
# Recipes also get their arguments as "$@", so `just gitnexus cypher "MATCH ..."`
# keeps each argument intact. `{{args}}` interpolation is unaffected.
set positional-arguments := true

tool := `command -v podman >/dev/null && echo podman || echo docker`
compose := tool + " compose"
# compose derives the project name from the directory name
project := lowercase(file_name(justfile_directory()))

# List available recipes
default:
    @just --list
    @echo -e "\nusing '{{tool}}' as a container tool."

#### Container

# podman if present, else docker -- every recipe goes through this

# Start the stack. Pass `-d` to detach (recommended -- see README).
up *args:
    {{compose}} up {{args}}

# Stop the stack, keeping volumes
down *args:
    {{compose}} down {{args}}

# Stop the stack and delete its built images (`just rm; just up` = clean rebuild).
rm *args:
    #!/usr/bin/env bash
    set -euo pipefail
    {{compose}} down --remove-orphans {{args}}
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
