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

**Current verification, 2026-11-11:** both DEV resources exist and are owned by
`foundation/dev`. A real plan using the complete C04 configuration at `1ae9c75`
returns no changes. No repair or redeployment was needed. See the
[C02 validation report](../infra/foundation/VALIDATION-2026-11-11.md).

## PROD backend prefix does not own the existing network

**Error:** a foundation PROD plan proposes creating the VPC and subnet even
though both exist on GCP. The configured `foundation/prod/default.tfstate` has
serial 1 and no resources; `foundation/prd/default.tfstate`, serial 5, owns the
existing VPC/subnet. The subnet has neither planned GKE secondary range.

**Occurrence:** 2026-11-11, final C02 audit after the C04 rebase.

**Cause:** the configured prefix and the state owning the resources differ.
Changing `prd` to `prod` in a backend file does not move the remote state object.

**Handling (blocked):** stop before apply. A read-only plan against the historical
prefix confirms ownership but also proposes Router/NAT creation alongside the
subnet update; it is not limited to adding secondary ranges. Keep both objects
intact. Review the authoritative backend and the intended change scope before
any further PROD action. Do not import the same VPC/subnet into the second state,
migrate state automatically, delete a state object or use a targeted apply to
hide the extra changes. GKE PROD could not be inventoried because its API is
disabled (403); no API was enabled as a workaround.
