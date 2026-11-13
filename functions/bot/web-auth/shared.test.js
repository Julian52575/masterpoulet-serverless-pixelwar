const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "web-auth";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "get-canvas", "snapshot-worker", "snapshot-notifier", "web-proxy"];

describe("code shared with the other services", () => {
  for (const other of LOGGERS) {
    test(`logger.js only differs from the ${other} one by the default service name`, () => {
      assert.equal(
        read(SERVICE, "logger.js").replace(`"${SERVICE}"`, '"<service>"'),
        read(other, "logger.js").replace(`"${other}"`, '"<service>"')
      );
    });
  }

  test("the token it hands out is the one web-proxy checks", () => {
    assert.equal(require("./oauth").USERS_ME, require(path.join(bot, "web-proxy", "auth")).USERS_ME);
  });
});
