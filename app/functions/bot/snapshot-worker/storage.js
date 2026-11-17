const SNAPSHOT_PREFIX = "snapshots/";
const MANIFEST_PREFIX = "manifests/";
const TILE_PREFIX = "tiles/";
const LATEST_MANIFEST = `${MANIFEST_PREFIX}latest.json`;
const PRIVATE = "private, max-age=0";

const isNotFound = (error) => error?.code === 404;

function createSnapshotStore({ bucket }) {
  const write = (name, data, contentType, metadata) =>
    bucket.file(name).save(data, {
      resumable: false,
      contentType,
      metadata: metadata ? { cacheControl: PRIVATE, metadata } : { cacheControl: PRIVATE }
    });

  async function read(name) {
    try {
      const [data] = await bucket.file(name).download();
      return data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function save({ name, png, metadata }) {
    await write(name, png, "image/png", metadata);
    return `gs://${bucket.name}/${name}`;
  }

  async function latestManifest() {
    const data = await read(LATEST_MANIFEST);
    return data ? JSON.parse(data.toString("utf8")) : null;
  }

  async function saveManifest(name, manifest) {
    const json = Buffer.from(JSON.stringify(manifest));
    await write(name, json, "application/json");
    await write(LATEST_MANIFEST, json, "application/json");
  }

  const readTile = (name) => read(name);
  const saveTile = (name, png) => write(name, png, "image/png");

  return { save, latestManifest, saveManifest, readTile, saveTile };
}

module.exports = { createSnapshotStore, SNAPSHOT_PREFIX, MANIFEST_PREFIX, TILE_PREFIX, LATEST_MANIFEST };
