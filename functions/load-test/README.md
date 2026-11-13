# Load test

`burst.js` sends a burst of website draws through the API Gateway, as many real users would. It is used during the defense to show, in the monitoring, that the serverless app **scales** (more `web-proxy` and `draw-pixel` instances) and that **Pub/Sub buffers** the draws when `draw-pixel` is behind.

It needs Node 22 or later and nothing else: no `npm install`.

```bash
cd functions/load-test
PIXELWAR_TOKENS="<token>" node burst.js --url https://<gateway host>/api --requests 2000 --concurrency 50
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `--url` | required | API base URL (`https://<gateway host>/api`). Plain `http` is only allowed for `localhost` |
| `--requests` | `200` | Number of draws to send |
| `--concurrency` | `20` | Draws in flight at the same time |
| `--rate` | `0` (no limit) | Maximum draws started per second, for a steady load instead of a burst |
| `--route` | `pixel` | `pixel` (`POST /pixels`) or `brush` (`POST /brush`) |
| `--size` | `4` | Brush size, 1 to 16 (a brush of 16 is 256 pixels in one request) |
| `--x`, `--y` | `0`, `0` | Top-left corner of the drawing zone |
| `--width` | `256` | Side of the square zone where the draws land (256 = one tile) |
| `--timeout` | `10` | Seconds before a draw counts as `timeout` |

`PIXELWAR_TOKENS` holds one or more Discord access tokens, separated by commas. The draws go to each token in turn. The tokens are read from the environment so they never show in the shell history or the process list, and the script never prints them.

## Getting a token

Log in on the website, then copy the `access_token` it got (from `sessionStorage`, or from the `#access_token=` part of the URL after the Discord login). It is valid about 7 days.

## Before you start

1. **Raise the quota of the test users.** A user can draw 20 pixels per minute by default, so almost every draw would answer `429`. An admin runs `/admin ratelimit user:<test user> limit:10000` in Discord (10000 is the maximum).
2. **Use several users for a big burst.** `draw-pixel` counts each user's pixels in one Firestore document per minute, inside a transaction. Many draws from one user at the same moment all write that same document, so Firestore makes them wait for each other. That shows as retries and a growing queue, which is a real limit, not a bug of the test. With 3 to 5 tokens the draws are spread over more documents.
3. **Check the safety limits.** Each function should have a maximum number of instances (for example 20 for `draw-pixel`, 10 for `web-proxy`) and the project a budget alert, so a test cannot run up the bill.
4. **Pick an empty zone** with `--x`, `--y` and `--width`, so the test does not paint over the real drawings. `/admin clear` cleans everything afterwards if needed.

## What it prints

```
run id:        5580ff0f
draws sent:    2000 in 41.3 s (48.4 per second)
queued (202):  1994, 1994 pixels accepted
statuses:      202: 1994, 429: 6
latency:       p50 180 ms, p95 420 ms, p99 900 ms, max 1350 ms
logs filter:   jsonPayload.correlation_id=~"^load-5580ff0f-"
```

The latency is the time `web-proxy` takes to answer, **not** the time until the pixel is on the canvas: a `202` means the draw is safely in the queue. `draw-pixel` writes it a little later. The exit code is `1` when no draw at all was queued (wrong URL or token), `2` on a usage mistake.

Each draw sends its own `X-Correlation-Id`: `load-<run id>-<number>`. web-proxy keeps it, so the `logs filter` line finds every log of this run in Cloud Logging, from web-proxy **and** draw-pixel. Each draw is also one trace in Trace Explorer.

## What to show in the monitoring

| Where | What you should see |
|---|---|
| Cloud Run → `web-proxy`, `draw-pixel` → Metrics → *Container instance count* | the number of instances goes up during the burst, then back down to zero |
| Cloud Run → *Request count* and *Request latency* | the requests per second follow the burst, and the latency stays stable |
| Pub/Sub → subscription `draw-pixel` → *Unacked messages* and *Oldest unacked message age* | goes up when draws come in faster than `draw-pixel` writes them, then drains back to zero: this is the queue buffering |
| Pub/Sub → subscription `draw-pixel-dlq-sub` | stays empty: no draw is lost |
| Cloud Logging, with the `logs filter` line | every draw of the run, with its `correlation_id`, `user_id` and `trace_id` |
| The website | the pixels appear in the chosen zone |

A good demo:
1. A steady load: `--rate 20 --requests 600` (30 seconds). The instances go up a little, and the queue stays near zero.
2. Then a burst: `--concurrency 100 --requests 3000 --route brush --size 8`. The instances go up more, the queue grows then drains, and nothing ends in the dead-letter topic.

## Tests

```bash
npm test
```

The tests check the options, the draws, the concurrency and the rate, the statistics, and run the real command against a small local HTTP server.
