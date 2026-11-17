#!/usr/bin/env python3
"""Adopt resources that already exist in the project (hand-made WIF, bucket, deployer),
so `terraform apply` updates them instead of failing with 409.

Usage: python3 import_existing.py myenv.tfvars   (resources that do not exist are skipped)
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def tf(*args, stdin=None):
    return subprocess.run(["terraform", *args], cwd=HERE, input=stdin, text=True, capture_output=True)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    var_file = str(Path(sys.argv[1]).resolve())

    def var(name):
        r = tf("console", f"-var-file={var_file}", stdin=f"var.{name}\n")
        if r.returncode:
            sys.exit(r.stderr)
        return r.stdout.strip().strip('"')

    project, repo, bucket = var("project_id"), var("github_repository"), var("state_bucket_name")
    pool, prov, sa_id = var("pool_id"), var("provider_id"), var("deployer_account_id")
    if project == "my-gcp-project":
        sys.exit("default.tfvars still holds placeholders: copy it, set your real values, and pass that file.")
    email = f"{sa_id}@{project}.iam.gserviceaccount.com"
    sa = f"projects/{project}/serviceAccounts/{email}"
    pool_name = f"projects/{project}/locations/global/workloadIdentityPools/{pool}"

    known = set(tf("state", "list").stdout.split())

    def adopt(addr, ident):
        if addr in known:
            return
        print(f">> import {addr}")
        r = tf("import", f"-var-file={var_file}", "-input=false", addr, ident)
        if r.returncode:
            reason = re.sub(r"\x1b\[[0-9;]*m|[│╷╵]", "", r.stderr)
            print("   skipped:", " ".join(reason.split())[:300])

    adopt("google_storage_bucket.state", f"{project}/{bucket}")
    adopt("google_service_account.deployer", sa)
    adopt("google_iam_workload_identity_pool.github", pool_name)
    adopt("google_iam_workload_identity_pool_provider.github", f"{pool_name}/providers/{prov}")
    adopt(
        "google_service_account_iam_member.github_impersonation",
        f"{sa} roles/iam.workloadIdentityUser "
        f"principalSet://iam.googleapis.com/{pool_name}/attribute.repository/{repo}",
    )
    roles = sorted(set(re.findall(r'"(roles/[A-Za-z.]+)"', (HERE / "main.tf").read_text())))
    for role in roles:
        adopt(f'google_project_iam_member.deployer["{role}"]', f"{project} {role} serviceAccount:{email}")


if __name__ == "__main__":
    main()
