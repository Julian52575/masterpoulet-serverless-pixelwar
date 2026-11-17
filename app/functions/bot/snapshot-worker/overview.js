const { encodePng } = require("./png");
const { TILE, GRID, parseTileId } = require("./tiles");

const MAX_IMAGE = 2048;
const EMPTY_SIZE = 64;
const CONCURRENCY = 16;

function regionOf(ids) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const [tx, ty] = parseTileId(id);
    x0 = Math.min(x0, tx * TILE);
    y0 = Math.min(y0, ty * TILE);
    x1 = Math.max(x1, Math.min(GRID, (tx + 1) * TILE) - 1);
    y1 = Math.max(y1, Math.min(GRID, (ty + 1) * TILE) - 1);
  }
  return { x0, y0, x1, y1 };
}

async function renderOverview({ tiles, loadTile, maxSize = MAX_IMAGE }) {
  const ids = Object.keys(tiles);
  if (ids.length === 0) {
    const rgb = Buffer.alloc(EMPTY_SIZE * EMPTY_SIZE * 3, 0xff);
    return { png: encodePng({ width: EMPTY_SIZE, height: EMPTY_SIZE, rgb }), region: null, scale: 1, width: EMPTY_SIZE, height: EMPTY_SIZE };
  }

  const region = regionOf(ids);
  const spanW = region.x1 - region.x0 + 1;
  const spanH = region.y1 - region.y0 + 1;
  const scale = Math.max(1, Math.ceil(Math.max(spanW, spanH) / maxSize));
  const width = Math.ceil(spanW / scale);
  const height = Math.ceil(spanH / scale);
  const rgb = Buffer.alloc(width * height * 3, 0xff);

  function draw(id, rgba) {
    const [tx, ty] = parseTileId(id);
    for (let py = 0; py < TILE; py++) {
      const gy = ty * TILE + py;
      if (gy >= GRID) break;
      const row = Math.floor((gy - region.y0) / scale) * width;
      for (let px = 0; px < TILE; px++) {
        const at = (py * TILE + px) * 4;
        if (rgba[at + 3] === 0) continue;
        const gx = tx * TILE + px;
        if (gx >= GRID) break;
        const cell = (row + Math.floor((gx - region.x0) / scale)) * 3;
        rgb[cell] = rgba[at];
        rgb[cell + 1] = rgba[at + 1];
        rgb[cell + 2] = rgba[at + 2];
      }
    }
  }

  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const batch = ids.slice(start, start + CONCURRENCY);
    const loaded = await Promise.all(batch.map(loadTile));
    batch.forEach((id, i) => draw(id, loaded[i]));
  }

  return { png: encodePng({ width, height, rgb }), region, scale, width, height };
}

module.exports = { renderOverview, MAX_IMAGE };
