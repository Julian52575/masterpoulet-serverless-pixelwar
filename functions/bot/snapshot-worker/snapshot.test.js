const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotTaker, snapshotName, InvalidRequestError } = require("./snapshot");
const { SIGNATURE } = require("./png");

function make(pixels = [{ x: 10, y: 20, color: "#ff0000", updated_at: new Date(0) }]) {
  const saved = [];
  const canvas = { visiblePixels: async () => pixels };
  const store = { save: async (file) => { saved.push(file); return `gs://snaps/${file.name}`; } };
  return { take: createSnapshotTaker({ canvas, store }), saved };
}

const request = (extra = {}) => ({
  type: "snapshot.requested",
  snapshot_id: "1565345221745573888",
  requested_at: "2026-10-29T12:43:03.572Z",
  requested_by: "999",
  application_id: "123456789012345678",
  interaction_token: "secret-token",
  channel_id: "555",
  correlation_id: "corr-7",
  ...extra
});

describe("snapshotName", () => {
  test("puts the time and the command id in the name, with only safe characters", () => {
    const name = snapshotName(new Date("2026-10-29T12:43:03.572Z"), "1565345221745573888");
    assert.equal(name, "snapshots/2026-10-29T12-43-03-572Z_1565345221745573888.png");
    assert.match(name, /^[A-Za-z0-9/_.-]+$/);
  });

  test("gives the same name to the same request, so a replay overwrites instead of duplicating", () => {
    const at = new Date("2026-10-29T12:43:03.572Z");
    assert.equal(snapshotName(at, "42"), snapshotName(at, "42"));
  });
});

describe("takeSnapshot", () => {
  test("renders the canvas and stores a PNG under its timestamped name", async () => {
    const { take, saved } = make();
    const result = await take(request());

    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, "snapshots/2026-10-29T12-43-03-572Z_1565345221745573888.png");
    assert.deepEqual(saved[0].png.subarray(0, 8), SIGNATURE);
    assert.equal(result.location, "gs://snaps/snapshots/2026-10-29T12-43-03-572Z_1565345221745573888.png");
    assert.equal(result.count, 1);
    assert.equal(result.bytes, saved[0].png.length);
  });

  test("attaches what the notifier needs as text metadata", async () => {
    const { take, saved } = make();
    await take(request());
    assert.deepEqual(saved[0].metadata, {
      snapshot_id: "1565345221745573888",
      requested_at: "2026-10-29T12:43:03.572Z",
      requested_by: "999",
      pixel_count: "1",
      application_id: "123456789012345678",
      interaction_token: "secret-token",
      channel_id: "555",
      correlation_id: "corr-7"
    });
    assert.ok(Object.values(saved[0].metadata).every((value) => typeof value === "string"));
  });

  test("still stores a snapshot of an empty canvas", async () => {
    const { take, saved } = make([]);
    const result = await take(request());
    assert.equal(result.count, 0);
    assert.equal(saved[0].metadata.pixel_count, "0");
  });

  for (const [name, bad] of Object.entries({
    "another event type": { type: "pixel.processed" },
    "a missing snapshot id": { snapshot_id: undefined },
    "a snapshot id that could change the file path": { snapshot_id: "../../index" },
    "a missing request time": { requested_at: undefined },
    "a request time that is not a date": { requested_at: "hier" }
  })) {
    test(`refuses ${name} without storing anything`, async () => {
      const { take, saved } = make();
      await assert.rejects(take(request(bad)), InvalidRequestError);
      assert.equal(saved.length, 0);
    });
  }
});
