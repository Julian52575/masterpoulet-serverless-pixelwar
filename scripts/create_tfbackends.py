#!/usr/bin/env python3
"""Create the Terraform GCS backend files of an environment (stdlib only).

Writes backends/<env>.hcl in infra/foundation and infra/serverless/functions.
Each stack gets its own state prefix: sharing one makes a stack plan to
destroy the other's resources.

    python3 scripts/create_tfbackends.py                         # asks everything
    python3 scripts/create_tfbackends.py --env rulian-test --bucket rulian-test-state
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STACKS = {
    "foundation": ROOT / "infra" / "foundation",
    "functions": ROOT / "infra" / "serverless" / "functions",
    "frontend": ROOT / "infra" / "frontend",
}
ENV_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$")


def ask(label, default=None, check=None, error=""):
    while True:
        suffix = f" [{default}]" if default else ""
        value = input(f"{label}{suffix}: ").strip() or (default or "")
        if value and (check is None or check(value)):
            return value
        print(f"  {error or 'A value is required.'}")


def confirm(question):
    return input(f"{question} [y/N] ").strip().lower() == "y"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", help="environment name, used as backends/<env>.hcl (e.g. rulian-test)")
    p.add_argument("--bucket", help="existing GCS bucket that holds the state")
    p.add_argument("--stack", action="append", choices=list(STACKS), help="limit to a stack (repeatable)")
    p.add_argument("--force", action="store_true", help="overwrite existing files without asking")
    args = p.parse_args()

    try:
        env = args.env or ask("Environment name", check=ENV_RE.match,
                              error="Use lowercase letters, digits and dashes.")
        if not ENV_RE.match(env):
            sys.exit("Invalid environment name: use lowercase letters, digits and dashes.")
        bucket = args.bucket or ask("State bucket name", default=f"{env}-state", check=BUCKET_RE.match,
                                    error="3-63 characters: lowercase letters, digits, '-', '_' or '.'.")
        if not BUCKET_RE.match(bucket):
            sys.exit("Invalid bucket name.")

        stacks = args.stack or list(STACKS)
        prefixes = {}
        for stack in stacks:
            default = f"{stack}/{env}"
            prefixes[stack] = default if args.env and args.bucket else ask(f"State prefix for {stack}", default)
        if len(set(prefixes.values())) != len(prefixes):
            sys.exit("Each stack needs its own prefix: a shared state would delete the other stack's resources.")

        written = []
        for stack, prefix in prefixes.items():
            path = STACKS[stack] / "backends" / f"{env}.hcl"
            if path.exists() and not args.force and not confirm(f"{path.relative_to(ROOT)} exists. Overwrite?"):
                print(f"  skipped {path.relative_to(ROOT)}")
                continue
            path.parent.mkdir(exist_ok=True)
            path.write_text(f'bucket = "{bucket}"\nprefix = "{prefix}"\n')
            written.append(stack)
            print(f"  wrote {path.relative_to(ROOT)}")
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nStopped, nothing more written.")

    if not written:
        return
    print(f"\nThe bucket must exist and be versioned before init:\n"
          f"  gcloud storage buckets create gs://{bucket} --project=<project-id> "
          f"--location=europe-west1 --uniform-bucket-level-access\n"
          f"  gcloud storage buckets update gs://{bucket} --versioning\n")
    print("Then, per stack (the project comes from <env>.tfvars, not from the backend):")
    for stack in written:
        rel = STACKS[stack].relative_to(ROOT)
        print(f"  cd {rel} && terraform init -reconfigure -backend-config=backends/{env}.hcl "
              f"&& terraform plan -var-file={env}.tfvars")


if __name__ == "__main__":
    main()
