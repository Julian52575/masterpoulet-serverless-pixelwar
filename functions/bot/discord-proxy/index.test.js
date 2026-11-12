const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const nacl = require("tweetnacl");

const keys = nacl.sign.keyPair();
const hex = (bytes) => Buffer.from(bytes).toString("hex");

function sign(body, timestamp) {
  return hex(nacl.sign.detached(Buffer.from(timestamp + body), keys.secretKey));
}

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.DISCORD_PUBLIC_KEY = hex(keys.publicKey);
    process.env.PUBSUB_TOPIC = "discord-command";
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("discordProxy");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("answers a signed PING with a PONG, using the raw body", async () => {
    const body = '{"type":1,  "id":"1"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sign(body, timestamp),
        "x-signature-timestamp": timestamp
      },
      body
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 1 });
  });

  test("answers 401 when the signature is missing", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"type":1}'
    });
    assert.equal(res.status, 401);
  });

  test("answers 405 to other methods", async () => {
    assert.equal((await fetch(baseUrl)).status, 405);
  });
});

describe("index.js startup", () => {
  test("refuses to load when the configuration is invalid", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /DISCORD_PUBLIC_KEY is not configured/);
  });
});
