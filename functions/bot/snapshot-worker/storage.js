const SNAPSHOT_PREFIX = "snapshots/";

function createSnapshotStore({ bucket }) {
  async function save({ name, png, metadata }) {
    const file = bucket.file(name);
    await file.save(png, {
      resumable: false,
      contentType: "image/png",
      metadata: {
        cacheControl: "private, max-age=0",
        metadata
      }
    });
    return `gs://${bucket.name}/${name}`;
  }

  return { save };
}

module.exports = { createSnapshotStore, SNAPSHOT_PREFIX };
