const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");

describe("loadConfig", () => {
  test("reads the bucket and uses one-hour links by default", () => {
    assert.deepEqual(loadConfig({ SNAPSHOT_BUCKET: "teamx-dev-snapshots" }), {
      bucket: "teamx-dev-snapshots",
      storageEndpoint: null,
      ttlMinutes: 60,
      problems: []
    });
  });

  test("reads a custom link lifetime and the optional emulator endpoint", () => {
    const config = loadConfig({ SNAPSHOT_BUCKET: "b-1", SIGNED_URL_TTL_MINUTES: " 15 ", STORAGE_API_ENDPOINT: "http://localhost:4443" });
    assert.equal(config.ttlMinutes, 15);
    assert.equal(config.storageEndpoint, "http://localhost:4443");
  });

  test("reports a missing or invalid bucket", () => {
    assert.deepEqual(loadConfig({}).problems, ["SNAPSHOT_BUCKET is not configured"]);
    assert.deepEqual(loadConfig({ SNAPSHOT_BUCKET: "gs://b" }).problems, ["SNAPSHOT_BUCKET is not a valid bucket name"]);
  });

  for (const bad of ["0", "-5", "1.5", "une heure", "10081"]) {
    test(`refuses a link lifetime of ${JSON.stringify(bad)} (Google allows at most 7 days)`, () => {
      assert.deepEqual(loadConfig({ SNAPSHOT_BUCKET: "b-1", SIGNED_URL_TTL_MINUTES: bad }).problems, [
        "SIGNED_URL_TTL_MINUTES must be a whole number between 1 and 10080"
      ]);
    });
  }
});
