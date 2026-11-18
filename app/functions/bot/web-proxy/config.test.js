const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { checkConfig } = require("./config");

describe("checkConfig", () => {
  test("accepts a configured draw topic", () => {
    assert.deepEqual(checkConfig({ DRAW_TOPIC: "draw-pixel" }), []);
  });

  test("reports a missing or blank draw topic", () => {
    assert.deepEqual(checkConfig({}), ["DRAW_TOPIC is not configured"]);
    assert.deepEqual(checkConfig({ DRAW_TOPIC: "  " }), ["DRAW_TOPIC is not configured"]);
  });
});

test("readBypassDiscord is true only for 'true'", () => {
  const { readBypassDiscord } = require("./config");
  const assert = require("node:assert/strict");
  assert.equal(readBypassDiscord({ BYPASS_DISCORD: "true" }), true);
  assert.equal(readBypassDiscord({ BYPASS_DISCORD: "false" }), false);
  assert.equal(readBypassDiscord({}), false);
});
