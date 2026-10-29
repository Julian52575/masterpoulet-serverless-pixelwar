const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { snowflakeTime } = require("./snowflake");

describe("snowflakeTime", () => {
  test("reads the creation time hidden in a Discord id (example from the Discord docs)", () => {
    assert.equal(snowflakeTime("175928847299117063").toISOString(), "2016-04-30T11:18:25.796Z");
  });

  test("gives later dates to later ids", () => {
    assert.ok(snowflakeTime("1300000000000000000") > snowflakeTime("1200000000000000000"));
  });

  for (const value of [undefined, null, "", "abc", "12.5", 175928847299117063, "123456789012345678901"]) {
    test(`returns null for ${JSON.stringify(value)}`, () => {
      assert.equal(snowflakeTime(value), null);
    });
  }
});
