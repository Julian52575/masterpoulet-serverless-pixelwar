#!/usr/bin/env python3
"""DEV-only foundation check: fmt, backend bucket audit, init, validate, plan."""
import argparse
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


DRY_RUN = False


def run(*cmd, capture=False):
    if DRY_RUN:
        print("+", " ".join(cmd))
        # Fake output so the flow continues without touching GCP.
        return "masterpoulet_bucket" if cmd[0] == "gcloud" else "default" if "workspace" in cmd else ""
    r = subprocess.run(cmd, cwd=HERE, text=True, capture_output=capture)
    if r.returncode != 0:
        sys.exit(f"Command failed: {' '.join(cmd)}\n{r.stderr if capture else ''}")
    return r.stdout.strip() if capture else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local-only", action="store_true", help="init with -backend=false, validate, no plan")
    ap.add_argument("--dry-run", action="store_true", help="print the commands without running them")
    args = ap.parse_args()
    local = args.local_only
    global DRY_RUN
    DRY_RUN = args.dry_run

    run("terraform", "fmt", "-check", "-recursive")

    if local:
        run("terraform", "init", "-backend=false", "-input=false")
    else:
        out = run("gcloud", "storage", "buckets", "list", "--project=masterpoulet-dev",
                  "--format=value(name)", "--quiet", capture=True)
        buckets = {b.removeprefix("gs://").rstrip("/") for b in out.splitlines()}
        m = re.search(r'^bucket\s*=\s*"([^"]+)"', (HERE / "backends/dev.hcl").read_text(), re.M)
        if not m:
            sys.exit("Missing backend bucket.")
        if m.group(1) not in buckets:
            sys.exit("Backend bucket not found in masterpoulet-dev. Approval and bootstrap are required.")
        run("terraform", "init", "-backend-config=backends/dev.hcl", "-input=false")
        if run("terraform", "workspace", "show", capture=True) != "default":
            sys.exit("Use the default workspace for the foundation/dev prefix.")

    run("terraform", "validate")

    if not local:
        run("terraform", "plan", "-var-file=dev.tfvars", "-input=false", "-lock-timeout=60s", "-out=dev.tfplan")


if __name__ == "__main__":
    main()
