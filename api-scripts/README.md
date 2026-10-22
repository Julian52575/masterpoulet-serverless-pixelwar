# api-scripts

Helper scripts that talk to the local dev app (`just up`). They use only the Python standard library.

## `draw_pixels.py`

Draws pixels through `POST /api/pixels`. Position and color are random unless given.

```bash
python3 api-scripts/draw_pixels.py <count> [options]
```

| Option | Default | Meaning |
|---|---|---|
| `count` | required | Number of pixels to draw |
| `--x`, `--y` | random | Fixed coordinate |
| `--color` | random | Fixed hex color, e.g. `#ff0000` |
| `--author` | `api-script` | Author recorded on each pixel |
| `--size` | `10000` | Grid size used for random positions (use a small value to draw near the top-left corner) |
| `--delay` | `0` | Seconds to wait between pixels, to watch the canvas update live |
| `--url` | `http://localhost:8000/api` | API base URL |

Each pixel prints its status: `202` accepted, `429` rate limited, `423` drawing paused. The script stops on 429 or 423. At the default limit of 20 pixels per minute, set `RATE_LIMIT=0` in `.env` for larger runs.

```bash
python3 api-scripts/draw_pixels.py 50 --size 64 --delay 0.2
```
