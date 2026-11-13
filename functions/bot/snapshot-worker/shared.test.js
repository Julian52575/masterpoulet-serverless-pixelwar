const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "snapshot-worker";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "tiles.js": ["get-canvas"],
  "overview.js": ["get-canvas"],
  "compose.js": ["get-canvas"],
  "config.js": ["get-canvas"],
  "envelope.js": ["admin-cmd", "draw-pixel", "get-canvas"],
  "fake-firestore.js": ["admin-cmd", "draw-pixel", "get-canvas", "web-proxy"],
  "png.js": ["get-canvas"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "get-canvas", "snapshot-notifier", "web-proxy", "web-auth"];

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

  test("uses the same tiles as draw-pixel", () => {
    const own = require("./tiles");
    const grid = require(path.join(bot, "draw-pixel", "grid"));
    const pixels = require(path.join(bot, "draw-pixel", "pixels"));
    assert.equal(own.TILE, grid.TILE);
    assert.equal(own.GRID, grid.SIZE);
    for (const [x, y] of [[0, 0], [255, 256], [9999, 9999]]) assert.equal(own.tileId(x, y), pixels.tileId(x, y));
  });

  test("finds the pixels draw-pixel writes, by their written_at field", async () => {
    const { fakeFirestore } = require("./fake-firestore");
    const { createPixelStore } = require(path.join(bot, "draw-pixel", "pixels"));
    const { createCanvasReader } = require("./state");
    const db = fakeFirestore();
    await createPixelStore({ db, now: () => 5000 }).draw({
      x: 3, y: 4, color: "#ff0000", author: "1", authorName: null, drawnAt: new Date(1000), limit: 20
    });
    const found = await createCanvasReader({ db }).pixelsWrittenSince(new Date(4999));
    assert.deepEqual(found.map((p) => [p.x, p.y, p.color]), [[3, 4, "#ff0000"]]);
  });

  test("reads the same Firestore collections as draw-pixel writes", () => {
    const own = require("./state");
    const theirs = require(path.join(bot, "draw-pixel", "state"));
    const pixels = require(path.join(bot, "draw-pixel", "pixels"));
    assert.equal(own.STATE_COLLECTION, theirs.STATE_COLLECTION);
    assert.equal(own.CANVAS_DOC, theirs.CANVAS_DOC);
    assert.equal(own.PIXELS_COLLECTION, pixels.PIXELS_COLLECTION);
  });

  test("converts Firestore dates the same way", () => {
    const own = require("./state");
    const theirs = require(path.join(bot, "draw-pixel", "state"));
    for (const value of [new Date(5), { toMillis: () => 7 }, undefined, null]) {
      assert.equal(own.toMillis(value), theirs.toMillis(value));
    }
  });
});
