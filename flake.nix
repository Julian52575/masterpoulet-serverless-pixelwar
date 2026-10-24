{
  description = "Dev environment template: Nix + Just + rootless Podman + Traefik";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
      ];

      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system:
          f nixpkgs.legacyPackages.${system}
        );
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShellNoCC {
          # Everything a bare `nix develop` needs so `just up` works with no
          # host container packages installed. Add project tooling here.
          packages = with pkgs; [
            lolcat
            just
            jq
            nodejs_24
            openssl # dev shell seeds .env's SESSION_SECRET (openssl rand -hex 32)
            # rootless podman stack
            podman
            podman-compose
            fuse-overlayfs # rootless overlay storage driver
            crun # OCI runtime (containers.conf pins runtime = "crun")
            slirp4netns # rootless networking / port publishing
            passt # pasta, podman's newer rootless net backend
            catatonit # lightweight PID 1 for `--init` / compose
            curl # the shellHook pings the podman API socket with it
            util-linux # setsid -- detaches the fallback API service from the tty
            # infra tooling
            git
            check-jsonschema # validates workflows: --builtin-schema vendor.github-workflows
            actionlint
            shellcheck # actionlint uses it to lint `run:` scripts
          ] ++ (import ./nix/tools.nix { inherit pkgs; }).all ++ [
          ];

          shellHook = ''
            if [ ! -e .env ] && [ -f .env.example ]; then
              cp .env.example .env && echo "env: created .env from .env.example"
            fi

            # --- .env (optional) -------------------------------------------
            if [ -f .env ]; then
              set -a
              . ./.env
              set +a
            fi

            # ==============================================================
            # macOS
            #
            # Podman is installed on the host (MacPorts).
            # Podman runs containers inside a Podman machine.
            #
            # Docker-compatible tools (docker-compose, testcontainers,
            # etc.) can communicate with Podman through DOCKER_HOST.
            # ==============================================================
            
            if [ "$(uname -s)" = "Darwin" ]; then
              export TMPDIR="/tmp/podman-tmp"
              mkdir -p "$TMPDIR"
              if ! command -v podman >/dev/null 2>&1; then
                echo "podman: Podman is not installed or not available in PATH." >&2
                echo "podman: install Podman with MacPorts." >&2
                exit 1
              fi

              echo "podman: using host Podman: $(podman --version)" | lolcat

              # ------------------------------------------------------------
              # Podman machine
              # ------------------------------------------------------------

              if ! podman info >/dev/null 2>&1; then
                echo "podman: Podman machine is not running." >&2
                echo "podman: start it with: podman machine start" >&2
                exit 1
              fi

              echo "podman: machine is running" | lolcat

              # ------------------------------------------------------------
              # Docker-compatible API
              #
              # On macOS, Podman runs inside podman machine.
              # The Podman CLI knows how to reach the VM through its configured
              # connection, so do not construct a Linux socket path ourselves.

              if [ -z "''${PODMAN_NO_SOCKET:-}" ]; then

                # On macOS, podman info retourne le socket Linux DANS la VM.
                # Il faut utiliser le socket exposé sur macOS par podman machine.

                podman_sock="/tmp/podman-tmp/podman/podman-machine-default-api.sock"

                if [ -z "$podman_sock" ]; then
                  echo "podman: unable to determine machine API socket." >&2
                  exit 1
                fi

                if [ ! -S "$podman_sock" ]; then
                  echo "podman: API socket does not exist: $podman_sock" >&2
                  exit 1
                fi

                export DOCKER_HOST="unix://$podman_sock"
                export DOCKER_SOCK="$podman_sock"

                echo "podman: Docker-compatible API: $DOCKER_HOST" | lolcat

              fi

            # ==============================================================
            # Linux
            # ==============================================================

            else

              proj="$(basename "$PWD")"

              # ------------------------------------------------------------
              # In-repository Podman configuration
              # ------------------------------------------------------------

              # Enforce podman backend usage
              export PODMAN_COMPOSE_PROVIDER="$(command -v podman-compose)"

              export PODMAN_CONFIG_DIR="$PWD/.config/podman"
              export CONTAINERS_CONF="$PODMAN_CONFIG_DIR/containers.conf"
              export CONTAINERS_STORAGE_CONF="$PODMAN_CONFIG_DIR/storage.conf"
              export CONTAINERS_REGISTRIES_CONF="$PODMAN_CONFIG_DIR/registries.conf"

              if [ ! -e ~/.config/containers/policy.json ] && \
                 [ ! -L ~/.config/containers/policy.json ]; then

                mkdir -p ~/.config/containers

                ln -s \
                  "$PODMAN_CONFIG_DIR/policy.json" \
                  ~/.config/containers/policy.json

                echo "podman: linked in-repo policy.json -> ~/.config/containers/policy.json"
              fi

              # ------------------------------------------------------------
              # Container storage
              # ------------------------------------------------------------

              STORAGE_ROOT="''${PODMAN_STORAGE_DIR:-$PWD/.containers}"

              mkdir -p "$STORAGE_ROOT"

              printf '%s\n' \
                '[storage]' \
                'driver = "overlay"' \
                "runroot = \"$STORAGE_ROOT/run\"" \
                "graphroot = \"$STORAGE_ROOT/storage\"" \
                '[storage.options]' \
                "mount_program = \"$(command -v fuse-overlayfs)\"" \
                > "$CONTAINERS_STORAGE_CONF"

              # ------------------------------------------------------------
              # Docker-compatible Podman API socket
              # ------------------------------------------------------------

              if [ -z "''${PODMAN_NO_SOCKET:-}" ]; then

                podman_sock="$(
                  podman info \
                    --format '{{.Host.RemoteSocket.Path}}' \
                    2>/dev/null || true
                )"

                : "''${podman_sock:=''${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock}"

                export DOCKER_HOST="unix://$podman_sock"
                export DOCKER_SOCK="$podman_sock"

                mkdir -p "$(dirname "$podman_sock")"

                _ping() {
                  curl \
                    -fsS \
                    --max-time 2 \
                    --unix-socket "$podman_sock" \
                    http://d/_ping \
                    >/dev/null 2>&1
                }

                _wait() {
                  for _ in $(seq 40); do
                    if _ping; then
                      return 0
                    fi

                    sleep 0.25
                  done

                  return 1
                }

                # ----------------------------------------------------------
                # Existing socket
                # ----------------------------------------------------------

                if _ping; then

                  echo "podman: reusing running API socket ($podman_sock)" | lolcat

                # ----------------------------------------------------------
                # systemd socket activation
                # ----------------------------------------------------------

                elif [ "$(systemctl --user show -p LoadState --value podman.socket 2>/dev/null)" = "loaded" ] \
                  && systemctl --user start podman.socket >/dev/null 2>&1 \
                  && _wait; then

                  echo "podman: using systemd --user podman.socket" | lolcat

                # ----------------------------------------------------------
                # Detached Podman API service
                # ----------------------------------------------------------

                else

                  pidfile="$(dirname "$podman_sock")/$proj-nix-shell.pid"
                  owned=""

                  rm -f "$pidfile"

                  if [ -e "$podman_sock" ] && ! _ping; then
                    rm -f "$podman_sock"
                  fi

                  if command -v setsid >/dev/null 2>&1; then

                    setsid sh -c \
                      'echo $$ > "$1"; exec podman system service --time=0 "unix://$2"' \
                      sh \
                      "$pidfile" \
                      "$podman_sock" \
                      >/dev/null 2>&1 &

                  else

                    (
                      trap "" INT QUIT HUP

                      echo $$ > "$pidfile"

                      exec podman system service \
                        --time=0 \
                        "unix://$podman_sock" \
                        >/dev/null 2>&1
                    ) &

                  fi

                  disown 2>/dev/null || true

                  for _ in $(seq 30); do
                    if [ -s "$pidfile" ]; then
                      break
                    fi

                    sleep 0.1
                  done

                  owned="$(cat "$pidfile" 2>/dev/null || true)"

                  [ -n "$owned" ] || owned=$!

                  if _wait; then
                    echo "podman: started API service (pid $owned)" | lolcat
                  else
                    echo "podman: warning -- API socket did not come up" >&2
                  fi

                  # --------------------------------------------------------
                  # Cleanup when this dev shell exits
                  # --------------------------------------------------------

                  trap '
                    _p="'"$owned"'"

                    if [ -n "$_p" ]; then
                      kill "$_p" 2>/dev/null || true

                      if [ "$(cat "'"$pidfile"'" 2>/dev/null)" = "$_p" ]; then
                        rm -f "'"$pidfile"'"
                      fi
                    fi
                  ' EXIT

                fi

              fi

            fi

            # ==============================================================
            # Conventional Commits
            # ==============================================================

            if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
              && [ "$(git config --local core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then

              git config --local core.hooksPath .githooks

              echo "git: commit-msg hook enabled (.githooks -- Conventional Commits)"
            fi

            # ==============================================================
            # Ready
            # ==============================================================

            echo "dev shell ready -- run 'just' to see available commands. Using $(podman --version)" | lolcat
          '';
        };
      });
    };
}