const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotReader, LATEST_MANIFEST } = require("./bucket");

function fakeBucket(objects, failure) {
  const asked = [];
  return {
    asked,
    file: (name) => ({
      download: async () => {
        asked.push(name);
        if (failure) throw failure;
        if (!objects.has(name)) throw Object.assign(new Error("No such object"), { code: 404 });
        return [objects.get(name)];
      },
      save: async () => assert.fail("get-canvas must never write to the bucket")
    })
  };
}

describe("createSnapshotReader", () => {
  test("reads the latest manifest", async () => {
    const bucket = fakeBucket(new Map([[LATEST_MANIFEST, Buffer.from('{"name":"manifests/a.json"}')]]));
    assert.deepEqual(await createSnapshotReader({ bucket }).latestManifest(), { name: "manifests/a.json" });
  });

  test("returns null when there is no snapshot yet", async () => {
    assert.equal(await createSnapshotReader({ bucket: fakeBucket(new Map()) }).latestManifest(), null);
  });

  test("reads a tile, or null when it is missing", async () => {
    const reader = createSnapshotReader({ bucket: fakeBucket(new Map([["tiles/0_0/a.png", Buffer.from([1])]])) });
    assert.deepEqual(await reader.readTile("tiles/0_0/a.png"), Buffer.from([1]));
    assert.equal(await reader.readTile("tiles/0_0/b.png"), null);
  });

  test("lets other errors reach the caller, so Pub/Sub retries", async () => {
    const reader = createSnapshotReader({ bucket: fakeBucket(new Map(), Object.assign(new Error("503"), { code: 503 })) });
    await assert.rejects(reader.latestManifest(), /503/);
  });
});
