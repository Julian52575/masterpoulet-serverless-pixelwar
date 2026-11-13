const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { checkConfig, readAdmins, readPublicKey } = require("./config");

const KEY = "a".repeat(64);
const TOPICS = { DRAW_TOPIC: "draw-pixel", COMMANDS_TOPIC: "commands", SNAPSHOT_TOPIC: "snapshot" };

describe("readPublicKey", () => {
  test("removes the trailing newline a secret created with echo would contain", () => {
    assert.equal(readPublicKey({ DISCORD_PUBLIC_KEY: `${KEY}\n` }), KEY);
  });

  test("removes surrounding spaces", () => {
    assert.equal(readPublicKey({ DISCORD_PUBLIC_KEY: `  ${KEY}  ` }), KEY);
  });

  test("returns undefined when the key is not set", () => {
    assert.equal(readPublicKey({}), undefined);
  });
});

describe("readAdmins", () => {
  test("reads both allow-lists and ignores empty entries", () => {
    assert.deepEqual(readAdmins({ ADMIN_USER_IDS: " 111,,222 ", ADMIN_ROLE_IDS: "900" }), { userIds: ["111", "222"], roleIds: ["900"] });
  });

  test("returns empty lists when nothing is configured", () => {
    assert.deepEqual(readAdmins({}), { userIds: [], roleIds: [] });
  });
});

describe("checkConfig", () => {
  test("accepts a complete configuration", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY, ...TOPICS }), []);
  });

  test("accepts a key with a trailing newline", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: `${KEY}\n`, ...TOPICS }), []);
  });

  test("reports a missing public key", () => {
    assert.deepEqual(checkConfig({ ...TOPICS }), ["DISCORD_PUBLIC_KEY is not configured"]);
  });

  test("reports an empty public key as missing", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: "  \n", ...TOPICS }), [
      "DISCORD_PUBLIC_KEY is not configured"
    ]);
  });

  test("reports a public key that is not 64 hexadecimal characters", () => {
    for (const bad of ["abc", "z".repeat(64), `${KEY}00`]) {
      assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: bad, ...TOPICS }), [
        "DISCORD_PUBLIC_KEY must be 64 hexadecimal characters"
      ]);
    }
  });

  for (const variable of Object.keys(TOPICS)) {
    test(`reports a missing ${variable}`, () => {
      assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY, ...TOPICS, [variable]: " " }), [`${variable} is not configured`]);
    });
  }

  test("accepts comma-separated admin ids", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY, ...TOPICS, ADMIN_USER_IDS: "111, 222", ADMIN_ROLE_IDS: "900" }), []);
  });

  test("reports admin ids that are not Discord ids", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY, ...TOPICS, ADMIN_USER_IDS: "111,alice", ADMIN_ROLE_IDS: "@admin" }), [
      "ADMIN_USER_IDS contains invalid Discord ids: alice",
      "ADMIN_ROLE_IDS contains invalid Discord ids: @admin"
    ]);
  });

  test("reports every problem at once", () => {
    assert.deepEqual(checkConfig({}), [
      "DISCORD_PUBLIC_KEY is not configured",
      "DRAW_TOPIC is not configured",
      "COMMANDS_TOPIC is not configured",
      "SNAPSHOT_TOPIC is not configured"
    ]);
  });
});
