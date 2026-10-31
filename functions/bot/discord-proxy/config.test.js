const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { checkConfig, readPublicKey } = require("./config");

const KEY = "a".repeat(64);

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

describe("checkConfig", () => {
  test("accepts a complete configuration", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY, PUBSUB_TOPIC: "discord-command" }), []);
  });

  test("accepts a key with a trailing newline", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: `${KEY}\n`, PUBSUB_TOPIC: "t" }), []);
  });

  test("reports a missing public key", () => {
    assert.deepEqual(checkConfig({ PUBSUB_TOPIC: "t" }), ["DISCORD_PUBLIC_KEY is not configured"]);
  });

  test("reports an empty public key as missing", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: "  \n", PUBSUB_TOPIC: "t" }), [
      "DISCORD_PUBLIC_KEY is not configured"
    ]);
  });

  test("reports a public key that is not 64 hexadecimal characters", () => {
    for (const bad of ["abc", "z".repeat(64), `${KEY}00`]) {
      assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: bad, PUBSUB_TOPIC: "t" }), [
        "DISCORD_PUBLIC_KEY must be 64 hexadecimal characters"
      ]);
    }
  });

  test("reports a missing Pub/Sub topic", () => {
    assert.deepEqual(checkConfig({ DISCORD_PUBLIC_KEY: KEY }), ["PUBSUB_TOPIC is not configured"]);
  });

  test("reports every problem at once", () => {
    assert.equal(checkConfig({}).length, 2);
  });
});
