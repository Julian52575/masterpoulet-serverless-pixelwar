const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");

describe("loadConfig", () => {
  test("reads comma-separated admin user and role ids", () => {
    const config = loadConfig({ ADMIN_USER_IDS: "111,222", ADMIN_ROLE_IDS: "777" });
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
    const config = loadConfig({});
    assert.deepEqual(config.problems, []);
    assert.deepEqual(config.warnings, ["no admin configured: every admin command will be refused"]);
  });

  test("reports ids that are not Discord snowflakes", () => {
    const config = loadConfig({ ADMIN_USER_IDS: "111,alice", ADMIN_ROLE_IDS: "@admin" });
    assert.deepEqual(config.problems, [
      "ADMIN_USER_IDS contains invalid Discord ids: alice",
      "ADMIN_ROLE_IDS contains invalid Discord ids: @admin"
    ]);
  });
});
