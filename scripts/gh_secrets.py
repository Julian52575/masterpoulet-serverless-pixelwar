#!/usr/bin/env python3
"""Set the GitHub secrets and variables the workflows read, one by one (stdlib + gh).

For each item (and each environment, when it is environment-scoped) the script
says whether it is already set and asks for a new value. Enter keeps the
current one. Secrets are typed hidden and sent to `gh` through stdin.

    python3 scripts/gh_secrets.py                       # pick categories
    python3 scripts/gh_secrets.py functions --env dev   # one category, one env
    python3 scripts/gh_secrets.py --missing             # only what is unset
    python3 scripts/gh_secrets.py --list                # status only
"""
import argparse
import getpass
import json
import subprocess
import sys
from dataclasses import dataclass

ENVIRONMENTS = ["dev", "prod"]


@dataclass(frozen=True)
class Item:
    name: str
    secret: bool  # False: GitHub variable (public, value shown)
    per_env: bool  # False: repository-level
    hint: str


# Keep in sync with the secrets.* / vars.* the workflows use.
CATALOG = {
    "ci": [
        Item("SONARQUBE_TOKEN", True, False, "SonarQube analysis token (ci-sast)"),
        Item("SAST_REPORT_TOKEN", True, False, "token that publishes the SAST report (ci-sast)"),
        Item("DISCORD_WEBHOOK_URL", True, False, "webhook notified on review requests"),
        Item("RO_TOKEN", True, False, "read-only token for release-to-ghcr"),
        Item("RELEASE_PLEASE_GITHUB_TOKEN", True, False, "PAT used by release-please"),
    ],
    "foundation": [
        Item("WIF_PROVIDER", False, True, "workload identity provider resource name"),
        Item("DEPLOYER_SA", False, True, "deployer service account email"),
    ],
    "functions": [
        Item("DISCORD_CLIENT_ID", False, True, "Discord application id"),
        Item("APP_URL", False, True, "optional: custom website URL (default https://<project>.web.app)"),
        Item("DISCORD_PUBLIC_KEY", True, True, "Discord application public key"),
        Item("DISCORD_OAUTH_CLIENT_SECRET", True, True, "Discord OAuth client secret"),
        Item("DISCORD_SNAPSHOT_WEBHOOK", True, True, "webhook URL that receives snapshots"),
        Item("DISCORD_BOT_TOKEN", True, True, "Discord bot token"),
    ],
}


def gh(*args, stdin=None, check=True):
    res = subprocess.run(["gh", *args], input=stdin, text=True, capture_output=True)
    if check and res.returncode:
        sys.exit(f"gh {' '.join(args)} failed: {res.stderr.strip()}")
    return res


def detect_repo():
    return gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner").stdout.strip()


def fetch_state(repo, env):
    """Return {name: (secret?, value-or-None, updatedAt)} for a scope (env=None: repository)."""
    scope = ["--env", env] if env else []
    state = {}
    for s in json.loads(gh("secret", "list", "-R", repo, *scope, "--json", "name,updatedAt").stdout):
        state[s["name"]] = (True, None, s["updatedAt"])
    for v in json.loads(gh("variable", "list", "-R", repo, *scope, "--json", "name,value,updatedAt").stdout):
        state[v["name"]] = (False, v["value"], v["updatedAt"])
    return state


def ensure_env(repo, env):
    existing = gh("api", f"repos/{repo}/environments", "--jq", ".environments[].name").stdout.split()
    if env in existing:
        return True
    if input(f"Environment '{env}' does not exist in {repo}. Create it? [y/N] ").strip().lower() != "y":
        return False
    gh("api", "-X", "PUT", f"repos/{repo}/environments/{env}", "--silent")
    return True


def describe(item, state):
    cur = state.get(item.name)
    if cur is None:
        return "NOT SET"
    when = cur[2][:10]
    return f"set ({when})" if item.secret else f"set to {cur[1]!r} ({when})"


def prompt_value(item, state):
    cur = state.get(item.name)
    keep = "Enter keeps it" if cur else "Enter skips"
    label = f"  new value ({keep}, q quits): "
    value = (getpass.getpass(label) if item.secret else input(label)).strip()
    if value.lower() == "q":
        raise KeyboardInterrupt
    return value


def apply(repo, item, env, value):
    scope = ["--env", env] if env else []
    kind = "secret" if item.secret else "variable"
    gh(kind, "set", item.name, "-R", repo, *scope, stdin=value)  # stdin keeps values off argv


def pick_categories(requested):
    names = list(CATALOG)
    bad = [r for r in requested if r not in CATALOG]
    if bad:
        sys.exit(f"Unknown category: {' '.join(bad)}")
    if requested:
        return requested
    answer = input(f"Categories [{' '.join(names)}] (Enter = all): ").split()
    bad = [a for a in answer if a not in CATALOG]
    if bad:
        sys.exit(f"Unknown category: {' '.join(bad)}")
    return answer or names


def run(args):
    repo = args.repo or detect_repo()
    envs = args.env or ENVIRONMENTS
    print(f"Repository: {repo}")

    states = {}  # scope -> state, fetched lazily
    def state_for(env):
        if env not in states:
            states[env] = fetch_state(repo, env)
        return states[env]

    for category in pick_categories(args.categories):
        print(f"\n=== {category} ===")
        for item in CATALOG[category]:
            kind = "secret" if item.secret else "variable"
            for env in (envs if item.per_env else [None]):
                if env and not args.list and not ensure_env(repo, env):
                    continue
                try:
                    state = state_for(env)
                except SystemExit:
                    if not args.list:
                        raise
                    state = {}  # environment missing
                status = describe(item, state)
                if args.missing and item.name in state:
                    continue
                print(f"\n{item.name} [{kind}, {env or 'repository'}] {status}\n  {item.hint}")
                if args.list:
                    continue
                value = prompt_value(item, state)
                if value:
                    apply(repo, item, env, value)
                    states.pop(env, None)
                    print("  updated")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("categories", nargs="*", metavar="category",
                   help=f"one or more of: {', '.join(CATALOG)} (default: ask)")
    p.add_argument("--env", action="append", choices=ENVIRONMENTS, help="limit to an environment (repeatable)")
    p.add_argument("--repo", help="owner/name (default: the current repository)")
    p.add_argument("--missing", action="store_true", help="only ask for items that are not set")
    p.add_argument("--list", action="store_true", help="show the status and exit")
    args = p.parse_args()
    try:
        run(args)
    except (KeyboardInterrupt, EOFError):
        print("\nStopped.")


if __name__ == "__main__":
    main()
