#!/usr/bin/env python3
"""Prepare a GKE cluster for infra/runners: kubeconfig, arc-runners namespace, arc-rw Secret.

Usage: scripts/arc_bootstrap.py dev|prod [--credentials-only]
--credentials-only stops after the kubeconfig (enough for `terraform plan`).
The PAT comes from $GITHUB_PAT or a hidden prompt; it is only sent to kubectl on stdin.
"""
import base64
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

NAMESPACE = "arc-runners"
SECRET = "arc-rw"
SECRET_KEY = "github_token"
ROOT = Path(__file__).resolve().parent.parent / "infra" / "runners"


def tfvar(env: str, name: str) -> str:
    text = (ROOT / f"{env}.tfvars").read_text(encoding="utf-8")
    m = re.search(rf'^{name}\s*=\s*"([^"]+)"', text, re.M)
    if not m:
        sys.exit(f"{name} not found in {env}.tfvars")
    return m.group(1)


def run(*cmd: str, stdin: str | None = None) -> None:
    subprocess.run(cmd, input=stdin, text=True, check=True)


def main() -> None:
    args = sys.argv[1:]
    credentials_only = "--credentials-only" in args
    args = [a for a in args if a != "--credentials-only"]
    if len(args) != 1 or args[0] not in ("dev", "prod"):
        sys.exit(__doc__)
    env = args[0]

    for tool in ("gcloud", "kubectl", "gke-gcloud-auth-plugin"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on PATH (run inside `nix develop`)")

    project, zone, cluster = (tfvar(env, k) for k in ("project_id", "zone", "cluster_name"))
    context = f"gke_{project}_{zone}_{cluster}"

    run("gcloud", "container", "clusters", "get-credentials", cluster,
        f"--zone={zone}", f"--project={project}", "--dns-endpoint")

    if credentials_only:
        print(f"{env}: context {context} ready")
        return

    # Apply (not create) so reruns are idempotent and also rotate the token.
    namespace = {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": NAMESPACE}}
    run("kubectl", f"--context={context}", "apply", "-f", "-", stdin=json.dumps(namespace))

    token = os.environ.get("GITHUB_PAT") or getpass.getpass("GitHub PAT (hidden): ")
    if not token:
        sys.exit("empty token")
    secret = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": SECRET, "namespace": NAMESPACE},
        "type": "Opaque",
        "data": {SECRET_KEY: base64.b64encode(token.encode()).decode()},
    }
    run("kubectl", f"--context={context}", "apply", "-f", "-", stdin=json.dumps(secret))
    print(f"{env}: context {context}, {NAMESPACE}/{SECRET} ready")


if __name__ == "__main__":
    main()
