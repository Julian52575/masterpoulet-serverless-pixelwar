const LATEST_MANIFEST = "manifests/latest.json";

const isNotFound = (error) => error?.code === 404;

function createSnapshotReader({ bucket }) {
  async function read(name) {
    try {
      const [data] = await bucket.file(name).download();
      return data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function latestManifest() {
    const data = await read(LATEST_MANIFEST);
    return data ? JSON.parse(data.toString("utf8")) : null;
  }

  return { latestManifest, readTile: read };
}

module.exports = { createSnapshotReader, LATEST_MANIFEST };
