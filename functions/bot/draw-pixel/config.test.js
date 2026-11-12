const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");
const { createHandlers } = require("./handlers");

describe("loadConfig", () => {
  test("reads the pixel events topic", () => {
    const config = loadConfig({ PIXEL_EVENTS_TOPIC: " pixel-events " });
    assert.equal(config.pixelEventsTopic, "pixel-events");
    assert.deepEqual(config.problems, []);
  });

  test("reports a missing pixel events topic", () => {
    assert.deepEqual(loadConfig({}).problems, ["PIXEL_EVENTS_TOPIC is not configured"]);
  });
});

describe("createHandlers", () => {
  test("only handles drawing, from Discord and from the web", () => {
    assert.deepEqual(Object.keys(createHandlers({})).sort(), ["draw", "web.draw"]);
  });
});
