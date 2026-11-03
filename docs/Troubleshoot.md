# Troubleshoot

Known incidents with their cause and fix. Rules for adding entries are in [CONTRIBUTOR.md](../CONTRIBUTOR.md#troubleshooting).

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
