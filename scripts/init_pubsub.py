#!/usr/bin/env python3
"""Initialize Pub/Sub emulator topics and subscriptions for local development.

Creates the `draw-pixel` topic and its push subscription pointing to the
`draw-pixel` function. Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


def wait_for_pubsub(host: str, timeout: int = 30) -> bool:
    """Wait for the Pub/Sub emulator to respond to health checks."""
    url = f"http://{host}/"
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status in (200, 404, 204):
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    return False


def create_topic(host: str, project: str, topic: str, dry_run: bool = False) -> None:
    """Create a topic in the Pub/Sub emulator."""
    url = f"http://{host}/v1/projects/{project}/topics/{topic}"
    if dry_run:
        print(f"[dry-run] PUT {url}")
        return
    req = urllib.request.Request(url, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Topic '{topic}': HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"Topic '{topic}' already exists.")
        else:
            raise


def create_push_subscription(
    host: str,
    project: str,
    topic: str,
    subscription: str,
    push_endpoint: str,
    dry_run: bool = False,
) -> None:
    """Create a push subscription in the Pub/Sub emulator."""
    url = f"http://{host}/v1/projects/{project}/subscriptions/{subscription}"
    payload = json.dumps(
        {
            "topic": f"projects/{project}/topics/{topic}",
            "pushConfig": {"pushEndpoint": push_endpoint},
        }
    ).encode("utf-8")
    if dry_run:
        print(f"[dry-run] PUT {url} -> {push_endpoint}")
        return
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Subscription '{subscription}': HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"Subscription '{subscription}' already exists.")
        else:
            raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--host",
        default=os.environ.get("PUBSUB_EMULATOR_HOST", "localhost:8085"),
        help="Pub/Sub emulator host:port (default: $PUBSUB_EMULATOR_HOST or localhost:8085)",
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", "local-project"),
        help="Google Cloud project ID (default: local-project)",
    )
    parser.add_argument(
        "--push-endpoint",
        default=os.environ.get("DRAW_PIXEL_PUSH_ENDPOINT", "http://draw-pixel:8080/"),
        help="HTTP push endpoint for draw-pixel worker (default: http://draw-pixel:8080/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without performing them",
    )
    args = parser.parse_args()

    print(f"Targeting Pub/Sub emulator at {args.host} for project {args.project}...")
    if not args.dry_run and not wait_for_pubsub(args.host):
        print(f"Error: Pub/Sub emulator at {args.host} is not reachable.", file=sys.stderr)
        return 1

    create_topic(args.host, args.project, "draw-pixel", dry_run=args.dry_run)
    create_push_subscription(
        args.host,
        args.project,
        "draw-pixel",
        "draw-pixel-sub",
        args.push_endpoint,
        dry_run=args.dry_run,
    )
    print("Pub/Sub emulator initialization complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
