const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotStore, LATEST_MANIFEST } = require("./storage");

function fakeBucket({ failDownload } = {}) {
  const saves = [];
  const objects = new Map();
  return {
    name: "teamx-dev-snapshots",
    saves,
    objects,
    file: (name) => ({
      save: async (data, options) => { saves.push({ name, data, options }); objects.set(name, data); },
      download: async () => {
        if (failDownload) throw failDownload;
        if (!objects.has(name)) throw Object.assign(new Error("No such object"), { code: 404 });
        return [objects.get(name)];
      }
    })
  };
}

describe("snapshot store", () => {
  test("uploads the PNG in one request, with its type and custom metadata", async () => {
    const bucket = fakeBucket();
    const png = Buffer.from([1, 2, 3]);
    await createSnapshotStore({ bucket }).save({ name: "snapshots/a.png", png, metadata: { snapshot_id: "42" } });

    assert.equal(bucket.saves.length, 1);
    assert.equal(bucket.saves[0].name, "snapshots/a.png");
    assert.equal(bucket.saves[0].data, png);
    assert.deepEqual(bucket.saves[0].options, {
      resumable: false,
      contentType: "image/png",
      metadata: { cacheControl: "private, max-age=0", metadata: { snapshot_id: "42" } }
    });
  });

  test("returns the gs:// location of the snapshot", async () => {
    const location = await createSnapshotStore({ bucket: fakeBucket() }).save({ name: "snapshots/a.png", png: Buffer.alloc(1), metadata: {} });
    assert.equal(location, "gs://teamx-dev-snapshots/snapshots/a.png");
  });

  test("lets a storage failure reach the caller", async () => {
    const bucket = { name: "b", file: () => ({ save: async () => { throw new Error("503 backend error"); } }) };
    await assert.rejects(createSnapshotStore({ bucket }).save({ name: "x.png", png: Buffer.alloc(1), metadata: {} }), /503/);
  });

  test("saves a tile as a PNG with no custom metadata", async () => {
    const bucket = fakeBucket();
    await createSnapshotStore({ bucket }).saveTile("tiles/0_0/a.png", Buffer.from([9]));
    assert.deepEqual(bucket.saves[0].options, { resumable: false, contentType: "image/png", metadata: { cacheControl: "private, max-age=0" } });
  });

  test("reads a tile back, and returns null when it does not exist", async () => {
    const bucket = fakeBucket();
    const store = createSnapshotStore({ bucket });
    await store.saveTile("tiles/0_0/a.png", Buffer.from([9]));
    assert.deepEqual(await store.readTile("tiles/0_0/a.png"), Buffer.from([9]));
    assert.equal(await store.readTile("tiles/0_0/missing.png"), null);
  });

  test("lets other read errors reach the caller, so Pub/Sub retries", async () => {
    const store = createSnapshotStore({ bucket: fakeBucket({ failDownload: Object.assign(new Error("503"), { code: 503 }) }) });
    await assert.rejects(store.readTile("tiles/0_0/a.png"), /503/);
  });

  test("saves the manifest under its name and as the latest one", async () => {
    const bucket = fakeBucket();
    const store = createSnapshotStore({ bucket });
    assert.equal(await store.latestManifest(), null);

    await store.saveManifest("manifests/a.json", { name: "manifests/a.json", tiles: {} });

    assert.deepEqual(bucket.saves.map((s) => [s.name, s.options.contentType]), [
      ["manifests/a.json", "application/json"],
      [LATEST_MANIFEST, "application/json"]
    ]);
    assert.deepEqual(await store.latestManifest(), { name: "manifests/a.json", tiles: {} });
  });
});
