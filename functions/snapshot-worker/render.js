const { encodePng } = require("./png");
const { toMillis } = require("./state");

const MAX_IMAGE = 2048;
const EMPTY_SIZE = 64;

function boundingBox(pixels) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { x, y } of pixels) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function renderCanvas(pixels, { maxSize = MAX_IMAGE } = {}) {
  if (pixels.length === 0) {
    const rgb = Buffer.alloc(EMPTY_SIZE * EMPTY_SIZE * 3, 0xff);
    return { png: encodePng({ width: EMPTY_SIZE, height: EMPTY_SIZE, rgb }), count: 0, region: null, scale: 1 };
  }

  const region = boundingBox(pixels);
  const spanW = region.x1 - region.x0 + 1;
  const spanH = region.y1 - region.y0 + 1;
  const scale = Math.max(1, Math.ceil(Math.max(spanW, spanH) / maxSize));
  const width = Math.ceil(spanW / scale);
  const height = Math.ceil(spanH / scale);

  const rgb = Buffer.alloc(width * height * 3, 0xff);
  const newest = new Float64Array(width * height).fill(-Infinity);

  for (const pixel of pixels) {
    const cell = Math.floor((pixel.y - region.y0) / scale) * width + Math.floor((pixel.x - region.x0) / scale);
    const at = toMillis(pixel.updated_at) ?? 0;
    if (at < newest[cell]) continue;
    newest[cell] = at;
    const n = Number.parseInt(pixel.color.slice(1), 16);
    rgb[cell * 3] = n >> 16;
    rgb[cell * 3 + 1] = (n >> 8) & 255;
    rgb[cell * 3 + 2] = n & 255;
  }

  return { png: encodePng({ width, height, rgb }), count: pixels.length, region, scale, width, height };
}

module.exports = { renderCanvas, MAX_IMAGE };
