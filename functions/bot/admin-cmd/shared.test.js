const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "admin-cmd";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "envelope.js": ["draw-pixel", "get-canvas", "snapshot-worker"],
  "discord.js": ["draw-pixel", "get-canvas", "snapshot-notifier"],
  "fake-firestore.js": ["draw-pixel", "get-canvas", "snapshot-worker", "web-proxy"],
  "grid.js": ["draw-pixel", "get-canvas", "web-proxy"],
  "pixels.js": ["draw-pixel", "get-canvas"],
  "reply.js": ["draw-pixel", "get-canvas"],
  "state.js": ["draw-pixel", "get-canvas", "web-proxy"],
  "events.js": ["draw-pixel"],
  "limits.js": ["draw-pixel", "web-proxy"],
  "snowflake.js": ["draw-pixel"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "get-canvas", "snapshot-worker", "snapshot-notifier", "web-proxy", "web-auth"];

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
