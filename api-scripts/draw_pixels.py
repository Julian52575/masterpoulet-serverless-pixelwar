#!/usr/bin/env python3
"""Draw pixels through the API gateway. Position and color are random unless given."""
import argparse
import json
import os
import random
import time
import urllib.error
import urllib.request


def post(url, body, token):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(url, json.dumps(body).encode(), headers)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except urllib.error.URLError as err:
        raise SystemExit(f"cannot reach {url}: {err.reason}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("count", type=int, help="number of pixels to draw")
    p.add_argument("--x", type=int, help="fixed x (default: random)")
    p.add_argument("--y", type=int, help="fixed y (default: random)")
    p.add_argument("--color", help="fixed hex color, e.g. #ff0000 (default: random)")
    p.add_argument("--token", default=os.environ.get("PIXELWAR_TOKEN"), help="Discord access token (default: $PIXELWAR_TOKEN)")
    p.add_argument("--size", type=int, default=10000, help="grid size for random positions")
    p.add_argument("--delay", type=float, default=0, help="seconds to wait between pixels")
    p.add_argument("--url", default=os.environ.get("PIXELWAR_URL"), help="gateway base URL, e.g. https://<host>/api (default: $PIXELWAR_URL)")
    args = p.parse_args()
    if not args.token or not args.url:
        p.error("--token and --url are required (or PIXELWAR_TOKEN and PIXELWAR_URL)")

    ok = 0
    for i in range(args.count):
        pixel = {
            "x": args.x if args.x is not None else random.randrange(args.size),
            "y": args.y if args.y is not None else random.randrange(args.size),
            "color": args.color or f"#{random.randrange(0x1000000):06x}",
        }
        status = post(f"{args.url}/pixels", pixel, args.token)
        ok += status == 202
        print(f"[{i + 1}/{args.count}] {pixel['x']},{pixel['y']} {pixel['color']} -> {status}")
        if status == 429:
            print("rate limited: retry in a minute")
            break
        if status == 401:
            print("token missing, expired or refused: log in again")
            break
        if status == 423:
            print("drawing is paused")
            break
        if args.delay and i < args.count - 1:
            time.sleep(args.delay)
    print(f"{ok}/{args.count} accepted")


if __name__ == "__main__":
    main()
