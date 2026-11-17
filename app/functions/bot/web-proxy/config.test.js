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
