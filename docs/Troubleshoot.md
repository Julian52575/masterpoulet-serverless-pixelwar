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

## Historical incident: PROD backend prefix does not own the existing network

**Current migration status:** see the [PROD migration report](../infra/foundation/MIGRATION-PROD-2026-11-11.md).
The observation below is archived. A prepared procedure and backups do not mean
the migration has run; the report records whether the maintenance freeze and
the state copy have actually completed.

**Error:** a foundation PROD plan proposes creating the VPC and subnet even
though both exist on GCP. The configured `foundation/prod/default.tfstate` has
serial 1 and no resources; `foundation/prd/default.tfstate`, serial 5, owns the
existing VPC/subnet. The subnet has neither planned GKE secondary range.

**Occurrence:** 2026-11-11, final C02 audit after the C04 rebase.

**Resolved state migration, 2026-11-12:** after explicit user and team freeze
confirmation, `terraform init -migrate-state` completed with interactive `yes`
and both backends locked. The canonical state retains the source lineage and
exact resource attributes/outputs, serial 5 to 6. The historical source remains
unchanged as a rollback archive and must have no writers. The new canonical plan
still proposes two creations and one in-place subnet update, with no deletion
or replacement; it was not applied. PROD has no required environment reviewer
or branch restriction, so old refs and cached historical backends remain a risk.
See the [fresh DEV/PROD audit](../infra/foundation/VALIDATION-2026-11-12.md).

**Resolved on 2026-11-13:** the necessary C04 definitions were brought onto the
current branch and `scale-set.tf` was aligned with `github-pat-arc`. The real
`runners/dev` plan now returns exit 0, no changes. Secret values were not read,
and no DEV apply or credential rotation was performed. See the
[deployment report](../infra/foundation/FINALISATION-PROD-2026-11-13.md).

Before a future OFF→ON cycle, the ARC credential must have a verified source
outside Kubernetes. The user confirmed on 2026-11-13 that none exists yet.
Deleting the cluster would lose its manually managed Secret. The ON/OFF scripts
require recovery confirmation before a real shutdown and block cluster creation
until Terraform restoration is integrated; see [the operator guide](../INFRA-POWER.md).

## Helm list rejects the legacy all-status flag

**Error:** `helm list -A -a -o json` fails with
`unknown shorthand flag: 'a' in -a` during the ON/OFF read-only preflight.

**Cause:** Helm 4 removed the legacy `-a` all-status flag.

**Solution:** use the explicit deployed, failed, pending, uninstalling and
superseded status flags. The scripts also reject a potentially truncated
inventory. No Helm install, uninstall or cloud change was needed to fix this.

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

## ARC runner plan references a missing Secret

**Error:** the 2026-11-12 DEV runners plan from C04 `1ae9c75` returns exit 2,
`0 to add, 1 to change, 0 to destroy`, changing `githubConfigSecret` from
`github-pat-arc` to `arc-rw`. The latter is absent from `arc-runners`.

**Cause:** the C04 configuration differs from both the deployed Helm release and
the owning `runners/dev` state. The live AutoscalingRunnerSet references
`github-pat-arc`; the controller and listener are running.

**Resolution required, not applied:** align the C04 Secret reference with the
existing working reference, or separately review and prepare an intentional
credential rotation. Then repeat the real runners plan. Do not apply the current
change, copy credential values into Terraform, recreate the releases or repeat
imports. Runtime operation alone does not establish configuration convergence.
See the [fresh DEV/PROD audit](../infra/foundation/VALIDATION-2026-11-12.md).

## ARC scale set label rejected by actionlint

**Error:** actionlint reports `label "masterpoulet-gke-runners" is unknown`, even
though the ARC smoke test succeeds on GKE.

**Occurrence:** 2026-10-30, integration of `feat/serverless-deployment` into
`feat/terraform-c04-gke`.

**Cause:** custom runner scale set names are not built-in GitHub-hosted labels.

**Solution:** list the exact scale set name in `self-hosted-runner.labels` in
`.github/actionlint.yaml`. Keep `runs-on: masterpoulet-gke-runners` in the workflow.
Do not suppress the label check or replace it with a GitHub-hosted runner.

## Prisma.sql missing after a fresh npm install

**Error:** backend worker tests fail with `Prisma.sql is not a function`.

**Occurrence:** 2026-10-30 on Windows after `npm ci`.

**Cause:** npm reported skipped install scripts, so the generated Prisma Client
was missing. This did not come from the merge's application code.

**Solution:** run `npm exec -- prisma generate` in `backend/`, then rerun the
tests. Generation needs no migration or database connection. All 52 backend
tests passed after generation; no application source was changed.

## Frontend tests blocked by the local sandbox

**Error:** Vite cannot load its config because a child process fails with
`spawn EPERM`; Python tests may also fail to access temporary directories.

**Occurrence:** 2026-10-30 on Windows during integration checks.

**Cause:** local sandbox process or filesystem restrictions.

**Solution:** rerun only the affected local checks with the required execution
permission. Do not change application code, disable TLS or weaken CI. The 23
frontend tests, production build and 30 Python inspector tests then passed.

## Dependency audit blocked by deepmerge in Jest

**Error:** the backend audit reports five low-severity package entries, reaching
the repository CI threshold of five moderate/low entries. The frontend has zero.

**Occurrence:** 2026-10-30 during the serverless/GKE integration.

**Cause:** [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
affects `deepmerge@4.3.1` and propagates through `jest-config`, `@jest/core`,
`jest-cli` and `jest`. Both branch tips already use `deepmerge@4.3.1` and
`jest@30.5.2`; the merge did not introduce those versions. The advisory lists
no patched version at the time of this check.

**Handling (unresolved):** stop before publication and have the dependency
remediation reviewed. npm proposes a major Jest downgrade among its fixes;
do not run a forced audit fix, lower the CI threshold or suppress the advisory
as part of conflict resolution. Keep the passing unit tests and audit failure
as separate results.

## C04 rebase after the C02 and serverless merges

**Error:** PR #12 contained duplicated C02 history, an unsigned ARC commit
(`554dc7c`), and a serverless merge followed by its revert.

**Occurrence:** 2026-11-11, rebasing `feat/terraform-c04-gke` on `origin/main`.

**Cause:** C02 commits had been copied between branches before C02 and serverless
were merged into main. Replaying the whole history would repeat that work and
could undo current workflows and hooks.

**Solution:** fetch first and back up both the remote and local branch tips,
including a verified Git bundle. Use merge-base, first-parent history and patch
comparisons to identify the six C04 commits. Replay them individually on main,
preserving the original empty CI trigger commit. Sign each with the existing
SSH signing key and retain the sign-offs and original authors. Resolve README
conflicts by retaining the C04 guide, the reviewer's `prod` corrections, and
main's read-only Python inspector. Restore the ARC actionlint label and combine
both troubleshooting histories. Verify all PR signatures and compare the final
Terraform, GKE and ARC files against the backup before a push with an explicit
force-with-lease expectation. Never apply or destroy infrastructure for a rebase.
