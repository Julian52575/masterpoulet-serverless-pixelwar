const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "get-canvas";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "envelope.js": ["admin-cmd", "draw-pixel", "snapshot-worker"],
  "discord.js": ["admin-cmd", "draw-pixel", "snapshot-notifier"],
  "fake-firestore.js": ["admin-cmd", "draw-pixel", "snapshot-worker"],
  "grid.js": ["admin-cmd", "draw-pixel"],
  "pixels.js": ["admin-cmd", "draw-pixel"],
  "reply.js": ["admin-cmd", "draw-pixel"],
  "state.js": ["admin-cmd", "draw-pixel"],
  "png.js": ["snapshot-worker"],
  "render.js": ["snapshot-worker"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "snapshot-worker", "snapshot-notifier"];

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
});
