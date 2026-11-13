const { SNAPSHOT_PREFIX, MANIFEST_PREFIX, TILE_PREFIX } = require("./storage");
const { toMillis } = require("./state");
const { TILE, GRID, tileId, parseTileId, emptyTile, encodeTile, decodeTile, paint, countPainted } = require("./tiles");
const { renderOverview } = require("./overview");
const { log } = require("./logger");

const SNAPSHOT_REQUESTED = "snapshot.requested";
const MANIFEST_VERSION = 1;
const WRITE_LAG_MS = 2 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const COLOR = /^#[0-9a-f]{6}$/;
const CONCURRENCY = 16;

class InvalidRequestError extends Error {}
class MissingTileError extends Error {}

function readRequest(event) {
  if (event.type !== SNAPSHOT_REQUESTED) throw new InvalidRequestError(`unexpected event type ${event.type}`);
  if (typeof event.snapshot_id !== "string" || !SAFE_ID.test(event.snapshot_id)) {
    throw new InvalidRequestError("invalid snapshot_id");
  }
  const requestedAt = new Date(event.requested_at);
  if (Number.isNaN(requestedAt.getTime())) throw new InvalidRequestError("invalid requested_at");
  return { snapshotId: event.snapshot_id, requestedAt };
}

const snapshotStem = (requestedAt, snapshotId) => `${requestedAt.toISOString().replace(/[:.]/g, "-")}_${snapshotId}`;
const snapshotName = (requestedAt, snapshotId) => `${SNAPSHOT_PREFIX}${snapshotStem(requestedAt, snapshotId)}.png`;

const isPixel = (p) =>
  Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID &&
  typeof p.color === "string" && COLOR.test(p.color);

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

async function inBatches(items, fn) {
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    await Promise.all(items.slice(start, start + CONCURRENCY).map(fn));
  }
}

function createSnapshotTaker({ canvas, store, now = () => new Date() }) {
  async function loadTile(object) {
    const png = await store.readTile(object);
    if (!png) throw new MissingTileError(`tile ${object} is missing from the bucket`);
    return decodeTile(png);
  }

  async function build({ previous, cleared, stem }) {
    const pixels = previous
      ? await canvas.pixelsWrittenSince(new Date(Date.parse(previous.taken_at) - WRITE_LAG_MS))
      : await canvas.visiblePixels(cleared);
    const groups = groupByTile(pixels, cleared);
    const tiles = previous ? { ...previous.tiles } : {};
    const changed = new Map();

    await inBatches([...groups.keys()], async (id) => {
      const [tx, ty] = parseTileId(id);
      const rgba = tiles[id] ? await loadTile(tiles[id].object) : emptyTile();
      for (const pixel of groups.get(id)) paint(rgba, tx, ty, pixel);
      const object = `${TILE_PREFIX}${id}/${stem}.png`;
      await store.saveTile(object, encodeTile(rgba));
      changed.set(id, { rgba, entry: { object, pixels: countPainted(rgba) } });
    });

    for (const [id, { entry }] of changed) tiles[id] = entry;
    return { tiles, changed, read: pixels.length };
  }

  return async function takeSnapshot(event) {
    const { snapshotId, requestedAt } = readRequest(event);
    const takenAt = now();
    const stem = snapshotStem(requestedAt, snapshotId);
    const name = `${SNAPSHOT_PREFIX}${stem}.png`;
    const manifestName = `${MANIFEST_PREFIX}${stem}.json`;

    const [latest, cleared] = await Promise.all([store.latestManifest(), canvas.clearedAt()]);
    const clearedAt = cleared?.toISOString() ?? null;
    const usable = latest?.version === MANIFEST_VERSION && latest.cleared_at === clearedAt ? latest : null;

    let built;
    let mode = usable ? "incremental" : "full";
    try {
      built = await build({ previous: usable, cleared, stem });
    } catch (error) {
      if (!(error instanceof MissingTileError)) throw error;
      log.warn("previous snapshot is incomplete, rebuilding from Firestore", { snapshot_id: snapshotId, error: error.message });
      mode = "full";
      built = await build({ previous: null, cleared, stem });
    }

    const { tiles, changed } = built;
    const pixelCount = Object.values(tiles).reduce((sum, tile) => sum + tile.pixels, 0);
    const previousName = mode === "incremental" && latest.name !== manifestName ? latest.name : latest?.previous ?? null;

    const manifest = {
      version: MANIFEST_VERSION,
      name: manifestName,
      snapshot_id: snapshotId,
      requested_at: requestedAt.toISOString(),
      taken_at: takenAt.toISOString(),
      cleared_at: clearedAt,
      previous: mode === "incremental" ? previousName : null,
      mode,
      tile_size: TILE,
      grid_size: GRID,
      pixel_count: pixelCount,
      changed_tiles: [...changed.keys()].sort(),
      image: name,
      tiles
    };

    const overview = await renderOverview({
      tiles,
      loadTile: async (id) => changed.get(id)?.rgba ?? loadTile(tiles[id].object)
    });

    await store.saveManifest(manifestName, manifest);

    const location = await store.save({
      name,
      png: overview.png,
      metadata: {
        snapshot_id: snapshotId,
        requested_at: requestedAt.toISOString(),
        requested_by: String(event.requested_by ?? ""),
        pixel_count: String(pixelCount),
        manifest: manifestName,
        application_id: String(event.application_id ?? ""),
        interaction_token: String(event.interaction_token ?? ""),
        channel_id: String(event.channel_id ?? ""),
        correlation_id: String(event.correlation_id ?? "")
      }
    });

    return {
      name,
      location,
      manifest: manifestName,
      mode,
      count: pixelCount,
      changedTiles: changed.size,
      pixelsRead: built.read,
      bytes: overview.png.length
    };
  };
}

module.exports = { createSnapshotTaker, snapshotName, snapshotStem, InvalidRequestError, SNAPSHOT_REQUESTED, WRITE_LAG_MS };
