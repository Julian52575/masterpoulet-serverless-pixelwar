const { test, describe, before, mock } = require("node:test");
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

async function captureLogs(fn) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    const stdout = out.mock.calls.map((call) => call.arguments[0]);
    const stderr = err.mock.calls.map((call) => call.arguments[0]);
    const lines = [...stdout, ...stderr];
    return { result, lines, stdout, stderr, entries: lines.map((line) => JSON.parse(line)) };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
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

  test("gives every command a UUID correlation id, returned in x-correlation-id", async () => {
    const res = await handler(signedEvent({ type: 2, id: "1", data: { name: "draw" } }));
    assert.match(
      res.headers["x-correlation-id"],
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  test("generates a different correlation id for each command", async () => {
    const event = () => signedEvent({ type: 2, id: "1", data: { name: "get" } });
    const first = await handler(event());
    const second = await handler(event());
    assert.notEqual(first.headers["x-correlation-id"], second.headers["x-correlation-id"]);
  });

  test("logs the same correlation id as the one it returns", async () => {
    const { result: res, entries } = await captureLogs(() =>
      handler(signedEvent({ type: 2, id: "1", data: { name: "get" } }))
    );
    const logged = entries.map((entry) => entry.correlation_id);
    assert.ok(logged.includes(res.headers["x-correlation-id"]));
  });

  test("logs a received command as one structured JSON line", async () => {
    const interaction = {
      type: 2,
      id: "interaction-9",
      guild_id: "guild-1",
      member: { user: { id: "111" } },
      data: { name: "draw" }
    };
    const { result: res, entries } = await captureLogs(() => handler(signedEvent(interaction)));
    const entry = entries.find((e) => e.message === "discord command received");

    assert.equal(entry.severity, "INFO");
    assert.equal(entry.function, "discord-proxy");
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
    assert.equal(entry.command, "draw");
    assert.equal(entry.user_id, "111");
    assert.equal(entry.interaction_id, "interaction-9");
    assert.equal(entry.guild_id, "guild-1");
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });

  test("never writes the interaction token or the signature to the logs", async () => {
    const event = signedEvent({ type: 2, id: "1", token: "secret-interaction-token", data: { name: "get" } });
    const { lines } = await captureLogs(() => handler(event));
    const all = lines.join("\n");
    assert.ok(!all.includes("secret-interaction-token"));
    assert.ok(!all.includes(event.headers["X-Signature-Ed25519"]));
  });

  test("logs a WARNING when a signature is rejected", async () => {
    const event = signedEvent({ type: 1 });
    event.headers["X-Signature-Ed25519"] = "0".repeat(128);
    const { entries } = await captureLogs(() => handler(event));
    const entry = entries.find((e) => e.message === "discord signature rejected");
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.has_signature, true);
  });

  test("logs an ERROR on stderr when the public key is not configured", async () => {
    const saved = process.env.DISCORD_PUBLIC_KEY;
    delete process.env.DISCORD_PUBLIC_KEY;
    try {
      const { stderr } = await captureLogs(() => handler(signedEvent({ type: 1 })));
      assert.equal(stderr.length, 1);
      assert.equal(JSON.parse(stderr[0]).severity, "ERROR");
    } finally {
      process.env.DISCORD_PUBLIC_KEY = saved;
    }
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
