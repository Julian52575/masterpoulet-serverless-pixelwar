const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "get-canvas";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "tiles.js": ["snapshot-worker"],
  "overview.js": ["snapshot-worker"],
  "compose.js": ["snapshot-worker"],
  "config.js": ["snapshot-worker"],
  "envelope.js": ["admin-cmd", "draw-pixel", "snapshot-worker"],
  "discord.js": ["admin-cmd", "draw-pixel", "snapshot-notifier"],
  "fake-firestore.js": ["admin-cmd", "draw-pixel", "snapshot-worker", "web-proxy"],
  "grid.js": ["admin-cmd", "draw-pixel", "web-proxy"],
  "pixels.js": ["admin-cmd", "draw-pixel"],
  "reply.js": ["admin-cmd", "draw-pixel"],
  "state.js": ["admin-cmd", "draw-pixel", "web-proxy"],
  "png.js": ["snapshot-worker"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "snapshot-worker", "snapshot-notifier", "web-proxy", "web-auth"];

describe("code shared with the other services", () => {
  for (const [file, services] of Object.entries(SHARED)) {
    for (const other of services) {
      test(`${file} is identical in ${other}`, () => {
        assert.equal(read(SERVICE, file), read(other, file), `apply the same change to functions/bot/${other}/${file}`);
      });
    }
  }

  for (const other of LOGGERS) {
    test(`logger.js only differs from the ${other} one by the default service name`, () => {
      assert.equal(
        read(SERVICE, "logger.js").replace(`"${SERVICE}"`, '"<service>"'),
        read(other, "logger.js").replace(`"${other}"`, '"<service>"')
      );
    });
  }

  test("reads the snapshots where snapshot-worker writes them", () => {
    assert.equal(require("./bucket").LATEST_MANIFEST, require(path.join(bot, "snapshot-worker", "storage")).LATEST_MANIFEST);
  });

  test("reads Firestore like snapshot-worker does", async () => {
    const { fakeFirestore } = require("./fake-firestore");
    const own = require("./canvas");
    const theirs = require(path.join(bot, "snapshot-worker", "state"));
    const db = fakeFirestore();
    db.docs.set("state/canvas", { cleared_at: new Date(1000) });
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(500), written_at: new Date(500) });
    db.docs.set("pixels/2_2", { x: 2, y: 2, color: "#00ff00", updated_at: new Date(2000), written_at: new Date(3000) });

    for (const reader of [own.createCanvasReader({ db }), theirs.createCanvasReader({ db })]) {
      const cleared = await reader.clearedAt();
      assert.deepEqual(cleared, new Date(1000));
      assert.deepEqual((await reader.visiblePixels(cleared)).map((p) => p.color), ["#00ff00"]);
      assert.deepEqual((await reader.pixelsWrittenSince(new Date(2500))).map((p) => p.color), ["#00ff00"]);
    }
  });

  test("shows the canvas from a real snapshot-worker snapshot plus the pixels drawn after it", async () => {
    const { fakeFirestore } = require("./fake-firestore");
    const { createSnapshotTaker } = require(path.join(bot, "snapshot-worker", "snapshot"));
    const { createCanvasReader: snapshotReader } = require(path.join(bot, "snapshot-worker", "state"));
    const { createCanvasView } = require("./view");
    const { createCanvasReader } = require("./canvas");

    const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);
    const db = fakeFirestore();
    const objects = new Map();
    let latest = null;
    const store = {
      save: async ({ name, png }) => { objects.set(name, png); return name; },
      saveTile: async (name, png) => { objects.set(name, png); },
      readTile: async (name) => objects.get(name) ?? null,
      latestManifest: async () => latest,
      saveManifest: async (name, manifest) => { latest = JSON.parse(JSON.stringify(manifest)); }
    };
    const draw = (x, y, color, at) => db.docs.set(`pixels/${x}_${y}`, { x, y, color, updated_at: new Date(at), written_at: new Date(at) });

    draw(10, 10, "#ff0000", T0 - 3600000);
    await createSnapshotTaker({ canvas: snapshotReader({ db }), store, now: () => new Date(T0) })({
      type: "snapshot.requested",
      snapshot_id: "1",
      requested_at: new Date(T0).toISOString()
    });
    draw(400, 10, "#00ff00", T0 + 60000);

    const image = await createCanvasView({ canvas: createCanvasReader({ db }), store })();

    assert.equal(image.source, "snapshot");
    assert.equal(image.count, 2);
    assert.equal(image.pixelsRead, 1);
    assert.deepEqual(image.region, { x0: 0, y0: 0, x1: 511, y1: 255 });
  });
});
