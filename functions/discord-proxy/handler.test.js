const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const nacl = require("tweetnacl");
const { handler, verifyDiscordRequest } = require("./handler");

const keys = nacl.sign.keyPair();
const publicKey = Buffer.from(keys.publicKey).toString("hex");

const now = () => String(Math.floor(Date.now() / 1000));

function sign(timestamp, body) {
  const message = Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]);
  return Buffer.from(nacl.sign.detached(message, keys.secretKey)).toString("hex");
}

function signedEvent(interaction, { timestamp = now(), base64 = false } = {}) {
  const body = JSON.stringify(interaction);
  return {
    headers: {
      "X-Signature-Ed25519": sign(timestamp, body),
      "X-Signature-Timestamp": timestamp
    },
    body: base64 ? Buffer.from(body).toString("base64") : body,
    isBase64Encoded: base64
  };
}

before(() => {
  process.env.DISCORD_PUBLIC_KEY = publicKey;
});

describe("verifyDiscordRequest", () => {
  test("accepts a valid signature", () => {
    const ts = now();
    const body = '{"type":1}';
    assert.equal(verifyDiscordRequest(publicKey, sign(ts, body), ts, body), true);
  });

  test("rejects a body modified after signing", () => {
    const ts = now();
    const signature = sign(ts, '{"type":1}');
    assert.equal(verifyDiscordRequest(publicKey, signature, ts, '{"type":2}'), false);
  });

  test("rejects a signature made with another key", () => {
    const other = nacl.sign.keyPair();
    const ts = now();
    const body = '{"type":1}';
    const signature = Buffer.from(
      nacl.sign.detached(Buffer.from(ts + body), other.secretKey)
    ).toString("hex");
    assert.equal(verifyDiscordRequest(publicKey, signature, ts, body), false);
  });

  test("rejects a timestamp older than 5 minutes (replay)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 301);
    const body = '{"type":1}';
    assert.equal(verifyDiscordRequest(publicKey, sign(old, body), old, body), false);
  });

  test("rejects a timestamp too far in the future", () => {
    const future = String(Math.floor(Date.now() / 1000) + 60);
    const body = '{"type":1}';
    assert.equal(verifyDiscordRequest(publicKey, sign(future, body), future, body), false);
  });

  test("rejects malformed inputs without throwing", () => {
    const ts = now();
    assert.equal(verifyDiscordRequest(publicKey, "not-hex", ts, "{}"), false);
    assert.equal(verifyDiscordRequest("short", sign(ts, "{}"), ts, "{}"), false);
    assert.equal(verifyDiscordRequest(publicKey, sign(ts, "{}"), "abc", "{}"), false);
    assert.equal(verifyDiscordRequest(undefined, undefined, undefined, undefined), false);
  });
});

describe("handler", () => {
  test("answers Discord's PING with a PONG", async () => {
    const res = await handler(signedEvent({ type: 1 }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { type: 1 });
  });

  test("defers slash commands (type 5)", async () => {
    const res = await handler(signedEvent({ type: 2, id: "1", data: { name: "draw" } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(res.body), { type: 5 });
  });

  test("accepts a base64-encoded body, as sent by local.js and the gateway", async () => {
    const res = await handler(signedEvent({ type: 1 }, { base64: true }));
    assert.equal(res.statusCode, 200);
  });

  test("keeps the signature valid for non-ASCII bodies", async () => {
    const interaction = { type: 2, data: { name: "draw", options: [{ name: "color", value: "rouge 🎨 éàü" }] } };
    const res = await handler(signedEvent(interaction, { base64: true }));
    assert.deepEqual(JSON.parse(res.body), { type: 5 });
  });

  test("rejects a missing signature with 401", async () => {
    const res = await handler({ headers: {}, body: '{"type":1}' });
    assert.equal(res.statusCode, 401);
  });

  test("rejects an invalid signature with 401", async () => {
    const event = signedEvent({ type: 1 });
    event.headers["X-Signature-Ed25519"] = "0".repeat(128);
    const res = await handler(event);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a tampered body with 401", async () => {
    const event = signedEvent({ type: 2, data: { name: "get" } });
    event.body = JSON.stringify({ type: 2, data: { name: "admin" } });
    const res = await handler(event);
    assert.equal(res.statusCode, 401);
  });

  test("rejects everything when the public key is not configured", async () => {
    const saved = process.env.DISCORD_PUBLIC_KEY;
    delete process.env.DISCORD_PUBLIC_KEY;
    try {
      const res = await handler(signedEvent({ type: 1 }));
      assert.equal(res.statusCode, 401);
    } finally {
      process.env.DISCORD_PUBLIC_KEY = saved;
    }
  });

  test("returns 400 for a signed body that is not JSON", async () => {
    const ts = now();
    const body = "not json";
    const res = await handler({
      headers: { "x-signature-ed25519": sign(ts, body), "x-signature-timestamp": ts },
      body
    });
    assert.equal(res.statusCode, 400);
  });

  test("returns 400 for an unsupported interaction type", async () => {
    const res = await handler(signedEvent({ type: 99 }));
    assert.equal(res.statusCode, 400);
  });
});
