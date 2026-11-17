const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.SNAPSHOT_BUCKET = "pixelwar-snapshots";
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("snapshotNotifier");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("answers 400 to a request that is not a storage event", async () => {
    const res = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
  });

  test("acks an event about another bucket without calling Discord", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "ce-type": "google.cloud.storage.object.v1.finalized",
        "ce-id": "1"
      },
      body: JSON.stringify({ bucket: "another-bucket", name: "snapshots/a.png" })
    });
    assert.equal(res.status, 204);
  });

  test("acks a bucket Pub/Sub notification about a tile, through the real framework", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          attributes: { eventType: "OBJECT_FINALIZE", bucketId: process.env.SNAPSHOT_BUCKET, objectId: "tiles/0_0/a.png" },
          data: "",
          messageId: "1"
        },
        subscription: "projects/demo/subscriptions/snapshot-created"
      })
    });
    assert.equal(res.status, 204);
  });

  test("answers 405 to other methods", async () => {
    assert.equal((await fetch(baseUrl)).status, 405);
  });
});

describe("index.js startup", () => {
  test("refuses to load without a snapshot bucket", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /SNAPSHOT_BUCKET is not configured/);
  });
});
