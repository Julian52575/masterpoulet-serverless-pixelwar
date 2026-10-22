#!/usr/bin/env python3
"""Draw pixels on the local dev app. Position and color are random unless given."""
import argparse
import json
import random
import time
import urllib.error
import urllib.request


def post(url, body):
    req = urllib.request.Request(
        url, json.dumps(body).encode(), {"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except urllib.error.URLError as err:
        raise SystemExit(f"cannot reach {url}: {err.reason} (is `just up` running?)")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("count", type=int, help="number of pixels to draw")
    p.add_argument("--x", type=int, help="fixed x (default: random)")
    p.add_argument("--y", type=int, help="fixed y (default: random)")
    p.add_argument("--color", help="fixed hex color, e.g. #ff0000 (default: random)")
    p.add_argument("--author", default="api-script")
    p.add_argument("--size", type=int, default=10000, help="grid size for random positions")
    p.add_argument("--delay", type=float, default=0, help="seconds to wait between pixels")
    p.add_argument("--url", default="http://localhost:8000/api", help="API base URL")
    args = p.parse_args()

    ok = 0
    for i in range(args.count):
        pixel = {
            "x": args.x if args.x is not None else random.randrange(args.size),
            "y": args.y if args.y is not None else random.randrange(args.size),
            "color": args.color or f"#{random.randrange(0x1000000):06x}",
            "author": args.author,
        }
        status = post(f"{args.url}/pixels", pixel)
        ok += status == 202
        print(f"[{i + 1}/{args.count}] {pixel['x']},{pixel['y']} {pixel['color']} -> {status}")
        if status == 429:
            print("rate limited: set RATE_LIMIT=0 in .env for dev, or retry later")
            break
        if status == 423:
            print("drawing is paused")
            break
        if args.delay and i < args.count - 1:
            time.sleep(args.delay)
    print(f"{ok}/{args.count} accepted")


if __name__ == "__main__":
    main()
