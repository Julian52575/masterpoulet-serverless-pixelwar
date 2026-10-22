# Collaborating

Make sure to read the README.md.

## Setup

1. Clone the repo and `cp .env.example .env`.
2. Install [just](https://github.com/casey/just) and Podman/Docker. (Or use the Nix dev shell, which provides both by: `nix develop`).
3. `just up --detach`, then open http://localhost:8000. (the port at ${PROXY_PORT})

See the [README](README.md) for the stack and the `just` recipes.

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

## Releases

Maintainers only: merging the release-please PR on `main` tags a release and publishes the images to GHCR. Don't bump versions by hand.
