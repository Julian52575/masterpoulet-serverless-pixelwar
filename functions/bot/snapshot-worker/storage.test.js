const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotStore } = require("./storage");

function fakeBucket() {
  const saves = [];
  return {
    name: "teamx-dev-snapshots",
    saves,
    file: (name) => ({ save: async (data, options) => { saves.push({ name, data, options }); } })
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
});
