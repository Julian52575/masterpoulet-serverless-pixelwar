# Troubleshoot

Known incidents with their cause and fix. Rules for adding entries are in [CONTRIBUTOR.md](../CONTRIBUTOR.md#troubleshooting).

## Missing router and NAT in dev

**Error:** `masterpoulet-dev-vpc-router` and `masterpoulet-dev-vpc-nat` are gone from GCP. `check.py --env dev` reports both as `missing_in_cloud`, and `gcloud compute routers list --project=masterpoulet-dev` returns `[]`. The GCP audit log shows `delete` calls on the router by `terraform-deployer`.

**Occurrences:** 2026-10-23, 15:51 Paris time (13:51 UTC).

**Cause:** the Terraform Deploy workflow applied an older Terraform configuration. A push to the `terraform-deployment-test` branch (commit `e23d1d5`, run [39964607195](https://github.com/Julian52575/serverless-pixelwar/actions/runs/39964607195)) triggered a deploy. That branch didn't contain `router.tf` and `nat.tf` (added in `3c3948f`). Terraform found both resources in the shared state but not in the config, and `terraform apply -auto-approve` destroyed them. The same run also applied to prod.

**Solution:**

1. Redeploy the newest configuration: run Terraform Deploy on the branch or tag that contains `router.tf` and `nat.tf`, in `plan` mode first, then `apply`.
2. Confirm with `python3 infra/foundation/scripts/check.py --env dev` (and `--env prod`).

**Prevention:** the deploy workflow now fails an apply whose plan deletes or replaces resources, unless the run's `allow_destroy` input is ticked. Before ticking it, check the "Resources to delete or replace" list in the job summary.
