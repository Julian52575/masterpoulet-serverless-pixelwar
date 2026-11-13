const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "snapshot-worker";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "envelope.js": ["admin-cmd", "draw-pixel", "get-canvas"],
  "fake-firestore.js": ["admin-cmd", "draw-pixel", "get-canvas", "web-proxy"],
  "png.js": ["get-canvas"],
  "render.js": ["get-canvas"]
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
