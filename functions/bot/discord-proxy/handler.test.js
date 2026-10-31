const { test, describe, before, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const nacl = require("tweetnacl");
const { createHandler, verifyDiscordRequest } = require("./handler");

const keys = nacl.sign.keyPair();
const publicKey = Buffer.from(keys.publicKey).toString("hex");

const now = () => String(Math.floor(Date.now() / 1000));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let published;
let failPublish;

const handler = createHandler({
  publish: async (event) => {
    if (failPublish) throw new Error("pubsub unavailable");
    published.push(event);
    return `message-${published.length}`;
  }
});

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

function slash(data, extra = {}) {
  return {
    type: 2,
    id: "interaction-1",
    application_id: "app-1",
    token: "token-1",
    guild_id: "guild-1",
    channel_id: "channel-1",
    member: { user: { id: "111", username: "alice" }, roles: ["900"] },
    data,
    ...extra
  };
}

const draw = (color = "#ff0000") => slash({
  name: "draw",
  options: [
    { name: "x", type: 4, value: 10 },
    { name: "y", type: 4, value: 20 },
    { name: "color", type: 3, value: color }
  ]
});

const get = (extra) => slash({ name: "get" }, extra);

const admin = (sub) => slash({ name: "admin", options: [{ name: sub, type: 1 }] });

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

beforeEach(() => {
  published = [];
  failPublish = false;
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
  test("answers Discord's PING with a PONG and publishes nothing", async () => {
    const res = await handler(signedEvent({ type: 1 }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { type: 1 });
    assert.equal(published.length, 0);
  });

  test("defers slash commands (type 5)", async () => {
    const res = await handler(signedEvent(draw()));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(res.body), { type: 5 });
  });

  test("gives every command a UUID correlation id, returned in x-correlation-id", async () => {
    const res = await handler(signedEvent(draw()));
    assert.match(res.headers["x-correlation-id"], UUID);
  });

  test("generates a different correlation id for each command", async () => {
    const first = await handler(signedEvent(get()));
    const second = await handler(signedEvent(get()));
    assert.notEqual(first.headers["x-correlation-id"], second.headers["x-correlation-id"]);
  });

  test("logs the same correlation id as the one it returns", async () => {
    const { result: res, entries } = await captureLogs(() => handler(signedEvent(get())));
    const logged = entries.map((entry) => entry.correlation_id);
    assert.ok(logged.includes(res.headers["x-correlation-id"]));
  });

  test("logs a received command as one structured JSON line", async () => {
    const event = signedEvent(slash({ name: "get" }, { id: "interaction-9" }));
    const { result: res, entries } = await captureLogs(() => handler(event));
    const entry = entries.find((e) => e.message === "discord command received");

    assert.equal(entry.severity, "INFO");
    assert.equal(entry.function, "discord-proxy");
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
    assert.equal(entry.command, "get");
    assert.equal(entry.user_id, "111");
    assert.equal(entry.interaction_id, "interaction-9");
    assert.equal(entry.guild_id, "guild-1");
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });

  test("never writes the interaction token or the signature to the logs", async () => {
    const event = signedEvent(get({ token: "secret-interaction-token" }));
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
    const res = await handler(signedEvent(draw("rouge 🎨 éàü"), { base64: true }));
    assert.deepEqual(JSON.parse(res.body), { type: 5 });
    assert.equal(published[0].payload.color, "rouge 🎨 éàü");
  });

  test("rejects a missing signature with 401", async () => {
    const res = await handler({ headers: {}, body: '{"type":1}' });
    assert.equal(res.statusCode, 401);
  });

  test("rejects an invalid signature with 401 and publishes nothing", async () => {
    const event = signedEvent(draw());
    event.headers["X-Signature-Ed25519"] = "0".repeat(128);
    const res = await handler(event);
    assert.equal(res.statusCode, 401);
    assert.equal(published.length, 0);
  });

  test("rejects a tampered body with 401", async () => {
    const event = signedEvent(get());
    event.body = JSON.stringify(admin("clear"));
    const res = await handler(event);
    assert.equal(res.statusCode, 401);
    assert.equal(published.length, 0);
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

  test("accepts a public key stored with a trailing newline in Secret Manager", async () => {
    const saved = process.env.DISCORD_PUBLIC_KEY;
    process.env.DISCORD_PUBLIC_KEY = `${publicKey}\n`;
    try {
      const res = await handler(signedEvent({ type: 1 }));
      assert.equal(res.statusCode, 200);
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

describe("handler publishing", () => {
  test("publishes the parsed command with its correlation id", async () => {
    const res = await handler(signedEvent(draw()));

    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
      type: "draw",
      payload: { x: 10, y: 20, color: "#ff0000" },
      user_id: "111",
      username: "alice",
      roles: ["900"],
      guild_id: "guild-1",
      channel_id: "channel-1",
      application_id: "app-1",
      interaction_id: "interaction-1",
      interaction_token: "token-1",
      correlation_id: res.headers["x-correlation-id"]
    });
  });

  test("publishes admin subcommands with their combined type", async () => {
    await handler(signedEvent(admin("pause")));
    assert.equal(published[0].type, "admin.pause");
  });

  test("makes the deferred reply ephemeral for admin commands only", async () => {
    const adminRes = await handler(signedEvent(admin("clear")));
    assert.deepEqual(JSON.parse(adminRes.body), { type: 5, data: { flags: 64 } });

    const snapshotRes = await handler(signedEvent(slash({ name: "snapshot" })));
    assert.deepEqual(JSON.parse(snapshotRes.body), { type: 5 });
  });

  test("logs the Pub/Sub message id once the command is published", async () => {
    const { result: res, entries } = await captureLogs(() => handler(signedEvent(get())));
    const entry = entries.find((e) => e.message === "discord command published");
    assert.equal(entry.severity, "INFO");
    assert.equal(entry.message_id, "message-1");
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
  });

  test("returns 500 and logs an ERROR when publishing fails", async () => {
    failPublish = true;
    const { result: res, entries } = await captureLogs(() => handler(signedEvent(draw())));

    assert.equal(res.statusCode, 500);
    assert.notEqual(JSON.parse(res.body).type, 5);
    const entry = entries.find((e) => e.message === "failed to publish discord command");
    assert.equal(entry.severity, "ERROR");
    assert.equal(entry.error, "pubsub unavailable");
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
  });

  test("answers an unknown command with an ephemeral message and publishes nothing", async () => {
    const res = await handler(signedEvent(slash({ name: "hack" })));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      type: 4,
      data: { content: "Commande inconnue.", flags: 64 }
    });
    assert.equal(published.length, 0);
  });

  test("treats a command with a missing option as unknown", async () => {
    const res = await handler(signedEvent(slash({
      name: "draw",
      options: [{ name: "x", type: 4, value: 1 }]
    })));
    assert.equal(JSON.parse(res.body).type, 4);
    assert.equal(published.length, 0);
  });
});
