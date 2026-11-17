const { renderOverview } = require("./overview");
const { MissingTileError, usableBase, readChanges, createTileLoader, paintChanges, countPixels } = require("./compose");
const { log } = require("./logger");

function createCanvasView({ canvas, store }) {
  const loadTile = createTileLoader(store.readTile);

  async function compose(base, cleared) {
    const { read, groups } = await readChanges({ canvas, base, cleared });
    const tiles = base ? base.tiles : {};
    const painted = await paintChanges({ groups, tiles, loadTile });
    const ids = Object.fromEntries([...Object.keys(tiles), ...painted.keys()].map((id) => [id, true]));
    const overview = await renderOverview({
      tiles: ids,
      loadTile: async (id) => painted.get(id) ?? loadTile(tiles[id].object)
    });
    return { ...overview, count: countPixels(tiles, painted), pixelsRead: read, changedTiles: painted.size };
  }

  return async function current() {
    const [latest, cleared] = await Promise.all([store.latestManifest(), canvas.clearedAt()]);
    const base = usableBase(latest, cleared);

    if (base) {
      try {
        return { ...(await compose(base, cleared)), source: "snapshot", snapshot: base.name };
      } catch (error) {
        if (!(error instanceof MissingTileError)) throw error;
        log.warn("snapshot is incomplete, reading the whole canvas from Firestore", { snapshot: base.name, error: error.message });
      }
    }
    return { ...(await compose(null, cleared)), source: "firestore", snapshot: null };
  };
}

module.exports = { createCanvasView };
