# api-scripts

Helper scripts that talk to the deployed API gateway (`infra/functions`). They use only the Python standard library.

## `draw_pixels.py`

Draws pixels through `POST /api/pixels` as one Discord user. Get an access token by logging in on the website (`#access_token=…`) and pass it with `--token` or `PIXELWAR_TOKEN`. Position and color are random unless given.

```bash
python3 api-scripts/draw_pixels.py <count> [options]
```

| Option | Default | Meaning |
|---|---|---|
| `count` | required | Number of pixels to draw |
| `--x`, `--y` | random | Fixed coordinate |
| `--color` | random | Fixed hex color, e.g. `#ff0000` |
| `--token` | `$PIXELWAR_TOKEN` | Discord access token; the author comes from it |
| `--size` | `10000` | Grid size used for random positions (use a small value to draw near the top-left corner) |
| `--delay` | `0` | Seconds to wait between pixels, to watch the canvas update live |
| `--url` | `$PIXELWAR_URL` | Gateway base URL, e.g. `https://<host>/api` |

Each pixel prints its status: `202` accepted, `429` rate limited, `423` drawing paused, `401` bad token. The script stops on 401, 423 or 429. The limit is 20 pixels per minute per user, shared with Discord, so larger runs stop early.

```bash
python3 api-scripts/draw_pixels.py 50 --size 64 --delay 0.2
```
