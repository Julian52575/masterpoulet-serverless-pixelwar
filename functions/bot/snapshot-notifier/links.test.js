const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotFiles } = require("./links");

function fakeBucket(metadata) {
  const signed = [];
  return {
    signed,
    file: (name) => ({
      getMetadata: async () => [{ name, contentType: "image/png", metadata }],
      getSignedUrl: async (options) => { signed.push({ name, options }); return [`https://signed/${name}`]; }
    })
  };
}

describe("snapshot files", () => {
  test("returns the custom metadata of a snapshot", async () => {
    const files = createSnapshotFiles({ bucket: fakeBucket({ snapshot_id: "42" }) });
    assert.deepEqual(await files.metadataOf("snapshots/a.png"), { snapshot_id: "42" });
  });

  test("returns an empty object when the snapshot has no custom metadata", async () => {
    const files = createSnapshotFiles({ bucket: fakeBucket(undefined) });
    assert.deepEqual(await files.metadataOf("snapshots/a.png"), {});
  });

  test("signs a V4 read-only link that expires after the given time", async () => {
    const bucket = fakeBucket({});
    const files = createSnapshotFiles({ bucket, now: () => 1_000_000 });
    const url = await files.signedUrl("snapshots/a.png", 60);

    assert.equal(url, "https://signed/snapshots/a.png");
    assert.deepEqual(bucket.signed, [{
      name: "snapshots/a.png",
      options: { version: "v4", action: "read", expires: 1_000_000 + 3_600_000 }
    }]);
  });
});
