const zlib = require("node:zlib");
const { SIGNATURE } = require("./png");

const TILE = 256;
const GRID = 10000;
const TILES_PER_SIDE = Math.ceil(GRID / TILE);
const BYTES = TILE * TILE * 4;
const RGBA = 6;

class InvalidTileError extends Error {}

const tileId = (x, y) => `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;
const parseTileId = (id) => id.split("_").map(Number);
const emptyTile = () => Buffer.alloc(BYTES);

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), body.length + 4);
  return out;
}

function encodeTile(rgba) {
  const stride = TILE * 4 + 1;
  const raw = Buffer.alloc(stride * TILE);
  for (let row = 0; row < TILE; row++) {
    rgba.copy(raw, row * stride + 1, row * TILE * 4, (row + 1) * TILE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TILE, 0);
  ihdr.writeUInt32BE(TILE, 4);
  ihdr.set([8, RGBA, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function decodeTile(png) {
  if (!Buffer.isBuffer(png) || png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) {
    throw new InvalidTileError("not a PNG");
  }

  const idat = [];
  let header = null;
  for (let at = 8; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") header = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += length + 12;
  }

  if (!header || header.readUInt32BE(0) !== TILE || header.readUInt32BE(4) !== TILE || header[8] !== 8 || header[9] !== RGBA) {
    throw new InvalidTileError(`a tile must be a ${TILE}x${TILE} 8-bit RGBA PNG`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = TILE * 4 + 1;
  if (raw.length !== stride * TILE) throw new InvalidTileError("truncated tile");

  const rgba = Buffer.alloc(BYTES);
  for (let row = 0; row < TILE; row++) {
    if (raw[row * stride] !== 0) throw new InvalidTileError("unsupported PNG filter");
    raw.copy(rgba, row * TILE * 4, row * stride + 1, (row + 1) * stride);
  }
  return rgba;
}

function paint(rgba, tx, ty, { x, y, color }) {
  const offset = ((y - ty * TILE) * TILE + (x - tx * TILE)) * 4;
  const n = Number.parseInt(color.slice(1), 16);
  rgba[offset] = n >> 16;
  rgba[offset + 1] = (n >> 8) & 255;
  rgba[offset + 2] = n & 255;
  rgba[offset + 3] = 255;
}

function countPainted(rgba) {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) count++;
  return count;
}

module.exports = {
  TILE,
  GRID,
  TILES_PER_SIDE,
  tileId,
  parseTileId,
  emptyTile,
  encodeTile,
  decodeTile,
  paint,
  countPainted,
  InvalidTileError
};
