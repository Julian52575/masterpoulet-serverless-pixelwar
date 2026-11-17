const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "draw-pixel";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "palette.js": ["web-proxy"],
  "envelope.js": ["admin-cmd", "get-canvas", "snapshot-worker"],
  "discord.js": ["admin-cmd", "get-canvas", "snapshot-notifier"],
  "fake-firestore.js": ["admin-cmd", "get-canvas", "snapshot-worker", "web-proxy"],
  "grid.js": ["admin-cmd", "get-canvas", "web-proxy"],
  "pixels.js": ["admin-cmd", "get-canvas"],
  "reply.js": ["admin-cmd", "get-canvas"],
  "state.js": ["admin-cmd", "get-canvas", "web-proxy"],
  "limits.js": ["admin-cmd", "web-proxy"],
  "snowflake.js": ["admin-cmd"],
  "tracing.js": ["discord-proxy", "admin-cmd", "get-canvas", "snapshot-worker", "snapshot-notifier", "web-proxy", "web-auth"]
};

const LOGGERS = ["discord-proxy", "admin-cmd", "get-canvas", "snapshot-worker", "snapshot-notifier", "web-proxy", "web-auth"];

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

  test("the Firestore security rules only open what the website reads, one tile at a time", () => {
    const rules = fs.readFileSync(path.join(bot, "..", "firestore", "firestore.rules"), "utf8");
    const { TILE } = require("./grid");
    const { PIXELS_COLLECTION, RATE_COLLECTION, PROCESSED_COLLECTION } = require("./pixels");
    const { STATE_COLLECTION, CANVAS_DOC } = require("./state");
    const { LIMITS_COLLECTION } = require("./limits");

    assert.match(rules, new RegExp(`request\\.query\\.limit <= ${TILE * TILE}\\b`));
    const opened = [...rules.matchAll(/match \/(\S+)\s*\{/g)].map((m) => m[1]).filter((p) => !p.startsWith("databases") && !p.startsWith("{"));
    assert.deepEqual(opened.sort(), [`${PIXELS_COLLECTION}/{pixel}`, `${STATE_COLLECTION}/${CANVAS_DOC}`].sort());
    for (const hidden of [RATE_COLLECTION, PROCESSED_COLLECTION, LIMITS_COLLECTION]) assert.ok(!rules.includes(`/${hidden}`), hidden);
    assert.ok(!/allow[^;]*(create|update|delete|write)[^;]*:\s*if true/.test(rules), "no rule may allow a write");
  });
});
