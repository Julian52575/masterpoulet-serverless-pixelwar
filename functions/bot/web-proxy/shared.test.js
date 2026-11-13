const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "web-proxy";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "fake-firestore.js": ["admin-cmd", "draw-pixel", "get-canvas", "snapshot-worker"],
  "grid.js": ["admin-cmd", "draw-pixel", "get-canvas"],
  "state.js": ["admin-cmd", "draw-pixel", "get-canvas"],
  "limits.js": ["admin-cmd", "draw-pixel"],
  "palette.js": ["draw-pixel"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "get-canvas", "snapshot-worker", "snapshot-notifier", "web-auth"];

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

  test("reads the same rate-limit counters as draw-pixel writes", () => {
    const own = require("./quota");
    const theirs = require(path.join(bot, "draw-pixel", "pixels"));
    assert.equal(own.RATE_COLLECTION, theirs.RATE_COLLECTION);
    assert.equal(own.WINDOW_MS, theirs.WINDOW_MS);
  });

  test("publishes web.draw events that draw-pixel accepts", async () => {
    const { createHandler } = require("./handler");
    const { readWebDraw } = require(path.join(bot, "draw-pixel", "draw"));
    const published = [];
    const handle = createHandler({
      authenticate: async () => ({ user_id: "123456789012345678", username: "Alice", cached: true }),
      quota: { check: async () => ({ status: "ok", accepted: 16 }) },
      publish: async (event) => { published.push(event); return "m"; }
    });

    const original = console.log;
    console.log = () => {};
    try {
      await handle({
        method: "POST",
        path: "/brush",
        headers: { authorization: "Bearer t" },
        rawBody: Buffer.from(JSON.stringify({ x: 0, y: 0, color: "blue", size: 16 }))
      });
    } finally {
      console.log = original;
    }

    const request = readWebDraw(published[0]);
    assert.equal(request.author, "123456789012345678");
    assert.equal(request.color, "#0083c7");
    assert.equal(request.cells.length, 81);
  });
});
