const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");

describe("loadConfig", () => {
  test("reads comma-separated admin user and role ids", () => {
    const config = loadConfig({ ADMIN_USER_IDS: "111,222", ADMIN_ROLE_IDS: "777", PIXEL_EVENTS_TOPIC: "pixel-events", SNAPSHOT_TOPIC: "snapshot-requested" });
    assert.deepEqual(config.adminUserIds, ["111", "222"]);
    assert.deepEqual(config.adminRoleIds, ["777"]);
    assert.deepEqual(config.problems, []);
    assert.deepEqual(config.warnings, []);
  });

  test("ignores spaces, newlines and empty entries", () => {
    const config = loadConfig({ ADMIN_USER_IDS: " 111 , ,222,\n", ADMIN_ROLE_IDS: "" });
    assert.deepEqual(config.adminUserIds, ["111", "222"]);
    assert.deepEqual(config.adminRoleIds, []);
  });

  test("warns, without failing, when no admin is configured", () => {
    const config = loadConfig({ PIXEL_EVENTS_TOPIC: "pixel-events", SNAPSHOT_TOPIC: "snapshot-requested" });
    assert.deepEqual(config.problems, []);
    assert.deepEqual(config.warnings, ["no admin configured: every admin command will be refused"]);
  });

  test("reports ids that are not Discord snowflakes", () => {
    const config = loadConfig({ ADMIN_USER_IDS: "111,alice", ADMIN_ROLE_IDS: "@admin", PIXEL_EVENTS_TOPIC: "pixel-events", SNAPSHOT_TOPIC: "snapshot-requested" });
    assert.deepEqual(config.problems, [
      "ADMIN_USER_IDS contains invalid Discord ids: alice",
      "ADMIN_ROLE_IDS contains invalid Discord ids: @admin"
    ]);
  });

  test("reads the topic where pixel events are published", () => {
    assert.equal(loadConfig({ PIXEL_EVENTS_TOPIC: " pixel-events \n" }).pixelEventsTopic, "pixel-events");
  });

  test("reports a missing pixel events topic", () => {
    assert.deepEqual(loadConfig({ ADMIN_USER_IDS: "111", SNAPSHOT_TOPIC: "s" }).problems, ["PIXEL_EVENTS_TOPIC is not configured"]);
  });

  test("reads the topic where snapshot requests are published", () => {
    assert.equal(loadConfig({ SNAPSHOT_TOPIC: " snapshot-requested " }).snapshotTopic, "snapshot-requested");
  });

  test("reports a missing snapshot topic", () => {
    assert.deepEqual(loadConfig({ ADMIN_USER_IDS: "111", PIXEL_EVENTS_TOPIC: "p" }).problems, ["SNAPSHOT_TOPIC is not configured"]);
  });
});
