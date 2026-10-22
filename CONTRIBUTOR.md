# Collaborating

Make sure to read the README.md.

## Setup

1. Clone the repo and `cp .env.example .env`.
2. Install [just](https://github.com/casey/just) and Podman/Docker. (Or use the Nix dev shell, which provides both by: `nix develop`).
3. `just up --detach`, then open http://localhost:8000. (the port at ${PROXY_PORT})

See the [README](README.md) for the stack and the `just` recipes.

The [`api-scripts/`](api-scripts/README.md) folder holds helper scripts that exercise the running app, e.g. `draw_pixels.py` to draw random pixels. Set `RATE_LIMIT=0` in `.env` when generating load.

## Workflow

1. Branch off `main`. Use a short name such as `feat/add-grid` or `fix/ws-reconnect`.
2. Make your change, and add or update tests in `backend/spec/` or next to the frontend component.
3. Check locally before pushing:
   ```bash
   cd backend  && npm run lint && npm test
   cd frontend && npm run lint && npm test
   ```
4. Open a pull request against `main`. It starts as a draft: mark it ready once CI is green.
5. Merge with a squash once `ci-required` passes and someone has approved.

## Conventions

- **PR titles follow [Conventional Commits](https://www.conventionalcommits.org/)**, for example `feat: add pixel grid` or `fix(backend): close ws on shutdown`. CI checks this, and release-please builds the changelog and version from these titles.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- **Link an issue** in the PR description.
- **Comments:** keep them short and explain why, not what.
- **Secrets** never go in git. `.env` is ignored; put new variables in `.env.example` with a safe placeholder.
- **Branches:** commit your work on branches and merge them to `main` using a **Pull Request**
- **Release:** Releases are made from `main` by closing the `release-please` Pull Request.

## Commit hooks

`nix develop` enables the hooks in `.githooks/` (or run `git config core.hooksPath .githooks`). Every commit message is checked for:

- the Conventional Commits format (the same rules as the PR title check)
- a `Signed-off-by` line: use `git commit -s`

You also get a warning if commit signing is off. To sign commits with your SSH key:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add the same key on GitHub (Settings → SSH and GPG keys) as a **Signing Key**. `--no-verify` skips the hooks locally.

## CI

Every PR runs `ci.yml` (lint, tests, Docker and compose lint, full-stack boot test, GitNexus) and `ci-sast.yml` (SonarQube, CodeQL). If GitNexus reports a stale `docs/gitnexus/api-links.md`, run `just gitnexus-docs-generate` and commit the result.

### SAST quality gates

`ci-sast-required` gates the merge. Both scans write their verdict to the run summary (open the run, then the job). On `main` the reports are also committed under `.sast/report/`.

**SonarQube Cloud** judges only the **new code** of the PR. Every condition must pass:

| Condition (new code) | Required |
|---|---|
| Coverage | ≥ 80% |
| Reliability rating (bugs) | A |
| Security rating (vulnerabilities) | A |
| Maintainability rating (code smells) | A |
| Duplicated lines | ≤ 3% |
| Security hotspots reviewed | 100% |

**CodeQL** runs the `code-scanning` suite on `backend/src` and `frontend/src`. Any **error**-severity alert fails the job; warnings are reported but do not block.

### New-code coverage policy

New and changed lines must be at least **80% covered**, counted across backend and frontend together. Old code is not held to the bar, but don't lower it.

- Add tests with the change, not afterwards: `backend/spec/*.spec.js` for the backend, `*.test.ts(x)` next to the frontend file.
- Check before pushing:
  ```bash
  cd backend  && npm run test:coverage
  cd frontend && npm run test:coverage
  ```
- Prefer testing behaviour through the public surface (HTTP routes with `supertest`, user interactions with Testing Library) over private helpers.
- Test files are excluded from analysis. Only `frontend/src/setupTests.ts` is excluded from coverage; ask before adding exclusions, they hide untested code from the gate.

## Releases

Maintainers only: merging the release-please PR on `main` tags a release and publishes the images to GHCR. Don't bump versions by hand.
