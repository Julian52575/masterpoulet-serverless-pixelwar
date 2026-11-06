const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");

describe("loadConfig", () => {
  test("reads the snapshot bucket", () => {
    assert.deepEqual(loadConfig({ SNAPSHOT_BUCKET: " teamx-dev-snapshots \n" }), {
      bucket: "teamx-dev-snapshots",
      storageEndpoint: null,
      problems: []
    });
  });

  test("reads an optional Cloud Storage endpoint, used only to reach a local emulator", () => {
    assert.equal(loadConfig({ SNAPSHOT_BUCKET: "b-1", STORAGE_API_ENDPOINT: " http://localhost:4443 " }).storageEndpoint, "http://localhost:4443");
  });

  test("reports a missing bucket", () => {
    assert.deepEqual(loadConfig({}).problems, ["SNAPSHOT_BUCKET is not configured"]);
  });

  for (const bad of ["gs://teamx-dev-snapshots", "Teamx", "a", "teamx/snapshots"]) {
    test(`reports ${JSON.stringify(bad)} as an invalid bucket name`, () => {
      assert.deepEqual(loadConfig({ SNAPSHOT_BUCKET: bad }).problems, ["SNAPSHOT_BUCKET is not a valid bucket name"]);
    });
  }
});
