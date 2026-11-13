const { GRID, tileId, emptyTile, decodeTile, paint, parseTileId, countPainted } = require("./tiles");

const MANIFEST_VERSION = 1;
const WRITE_LAG_MS = 2 * 60 * 1000;
const COLOR = /^#[0-9a-f]{6}$/;
const CONCURRENCY = 16;

class MissingTileError extends Error {}

const toMillis = (value) => value?.toMillis?.() ?? value?.getTime?.() ?? null;

const isPixel = (p) =>
  Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID &&
  typeof p.color === "string" && COLOR.test(p.color);

function usableBase(latest, cleared) {
  const clearedAt = cleared?.toISOString() ?? null;
  return latest?.version === MANIFEST_VERSION && latest.cleared_at === clearedAt ? latest : null;
}

function groupByTile(pixels, cleared) {
  const groups = new Map();
  for (const pixel of pixels) {
    if (!isPixel(pixel)) continue;
    if (cleared && (toMillis(pixel.updated_at) ?? 0) <= cleared.getTime()) continue;
    const id = tileId(pixel.x, pixel.y);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(pixel);
  }
  for (const list of groups.values()) list.sort((a, b) => (toMillis(a.updated_at) ?? 0) - (toMillis(b.updated_at) ?? 0));
  return groups;
}

async function readChanges({ canvas, base, cleared }) {
  const pixels = base
    ? await canvas.pixelsWrittenSince(new Date(Date.parse(base.taken_at) - WRITE_LAG_MS))
    : await canvas.visiblePixels(cleared);
  return { read: pixels.length, groups: groupByTile(pixels, cleared) };
}

async function inBatches(items, fn) {
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    await Promise.all(items.slice(start, start + CONCURRENCY).map(fn));
  }
}

function createTileLoader(readTile) {
  return async function loadTile(object) {
    const png = await readTile(object);
    if (!png) throw new MissingTileError(`tile ${object} is missing from the bucket`);
    return decodeTile(png);
  };
}

async function paintChanges({ groups, tiles, loadTile }) {
  const painted = new Map();
  await inBatches([...groups.keys()], async (id) => {
    const [tx, ty] = parseTileId(id);
    const rgba = tiles[id] ? await loadTile(tiles[id].object) : emptyTile();
    for (const pixel of groups.get(id)) paint(rgba, tx, ty, pixel);
    painted.set(id, rgba);
  });
  return painted;
}

function countPixels(tiles, painted) {
  let count = 0;
  for (const id of new Set([...Object.keys(tiles), ...painted.keys()])) {
    count += painted.has(id) ? countPainted(painted.get(id)) : tiles[id].pixels;
  }
  return count;
}

module.exports = {
  MANIFEST_VERSION,
  WRITE_LAG_MS,
  MissingTileError,
  usableBase,
  groupByTile,
  readChanges,
  inBatches,
  createTileLoader,
  paintChanges,
  countPixels
};
