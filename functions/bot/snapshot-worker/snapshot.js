const { SNAPSHOT_PREFIX, MANIFEST_PREFIX, TILE_PREFIX } = require("./storage");
const { TILE, GRID, encodeTile, countPainted } = require("./tiles");
const { renderOverview } = require("./overview");
const {
  MANIFEST_VERSION,
  WRITE_LAG_MS,
  MissingTileError,
  usableBase,
  readChanges,
  inBatches,
  createTileLoader,
  paintChanges
} = require("./compose");
const { log } = require("./logger");

const SNAPSHOT_REQUESTED = "snapshot.requested";
const SNAPSHOT_SCHEDULED = "snapshot.scheduled";
const SCHEDULER = "scheduler";
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

class InvalidRequestError extends Error {}

function readScheduled({ messageId, publishTime } = {}) {
  const snapshotId = `scheduled-${messageId}`;
  if (typeof messageId !== "string" || !SAFE_ID.test(snapshotId)) throw new InvalidRequestError("invalid scheduler message id");
  const requestedAt = new Date(publishTime);
  if (Number.isNaN(requestedAt.getTime())) throw new InvalidRequestError("invalid scheduler publish time");
  return { snapshotId, requestedAt, scheduled: true };
}

function readRequest(event, message) {
  if (event.type === SNAPSHOT_SCHEDULED) return readScheduled(message);
  if (event.type !== SNAPSHOT_REQUESTED) throw new InvalidRequestError(`unexpected event type ${event.type}`);
  if (typeof event.snapshot_id !== "string" || !SAFE_ID.test(event.snapshot_id)) {
    throw new InvalidRequestError("invalid snapshot_id");
  }
  const requestedAt = new Date(event.requested_at);
  if (Number.isNaN(requestedAt.getTime())) throw new InvalidRequestError("invalid requested_at");
  return { snapshotId: event.snapshot_id, requestedAt, scheduled: false };
}

const snapshotStem = (requestedAt, snapshotId) => `${requestedAt.toISOString().replace(/[:.]/g, "-")}_${snapshotId}`;
const snapshotName = (requestedAt, snapshotId) => `${SNAPSHOT_PREFIX}${snapshotStem(requestedAt, snapshotId)}.png`;

function createSnapshotTaker({ canvas, store, now = () => new Date() }) {
  const loadTile = createTileLoader(store.readTile);

  async function build({ previous, cleared, stem }) {
    const { read, groups } = await readChanges({ canvas, base: previous, cleared });
    const tiles = previous ? { ...previous.tiles } : {};
    const painted = await paintChanges({ groups, tiles, loadTile });
    const changed = new Map();

    await inBatches([...painted.entries()], async ([id, rgba]) => {
      const object = `${TILE_PREFIX}${id}/${stem}.png`;
      await store.saveTile(object, encodeTile(rgba));
      changed.set(id, { rgba, entry: { object, pixels: countPainted(rgba) } });
    });

    for (const [id, { entry }] of changed) tiles[id] = entry;
    return { tiles, changed, read };
  }

  return async function takeSnapshot(event, message = {}) {
    const { snapshotId, requestedAt, scheduled } = readRequest(event, message);
    const takenAt = now();
    const stem = snapshotStem(requestedAt, snapshotId);
    const name = `${SNAPSHOT_PREFIX}${stem}.png`;
    const manifestName = `${MANIFEST_PREFIX}${stem}.json`;

    const [latest, cleared] = await Promise.all([store.latestManifest(), canvas.clearedAt()]);
    const clearedAt = cleared?.toISOString() ?? null;
    const usable = usableBase(latest, cleared);

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

    if (scheduled && mode === "incremental" && built.read === 0) {
      return { skipped: true, snapshotId, mode, pixelsRead: 0 };
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
        requested_by: scheduled ? SCHEDULER : String(event.requested_by ?? ""),
        pixel_count: String(pixelCount),
        manifest: manifestName,
        application_id: String(event.application_id ?? ""),
        interaction_token: String(event.interaction_token ?? ""),
        channel_id: String(event.channel_id ?? ""),
        correlation_id: String(event.correlation_id ?? (scheduled ? snapshotId : ""))
      }
    });

    return {
      skipped: false,
      snapshotId,
      scheduled,
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

module.exports = {
  createSnapshotTaker,
  snapshotName,
  snapshotStem,
  InvalidRequestError,
  SNAPSHOT_REQUESTED,
  SNAPSHOT_SCHEDULED,
  WRITE_LAG_MS
};
