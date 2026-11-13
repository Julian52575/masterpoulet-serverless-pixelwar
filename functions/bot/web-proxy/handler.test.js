const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, MAX_BODY_BYTES } = require("./handler");
const { UnauthorizedError, DiscordUnavailableError } = require("./auth");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = new Date("2026-11-13T09:00:00.000Z");
const ALICE = { user_id: "123456789012345678", username: "Alice", cached: false };

function setup({ user = ALICE, authError, check = { status: "ok", accepted: 1 }, publishError } = {}) {
  const published = [];
  const checks = [];
  const handle = createHandler({
    authenticate: async (header) => {
      if (authError) throw authError;
      assert.equal(header, "Bearer good-token");
      return user;
    },
    quota: { check: async (userId, area) => { checks.push({ userId, area }); return check; } },
    publish: async (event) => {
      if (publishError) throw publishError;
      published.push(event);
      return "msg-1";
    },
    now: () => NOW
  });
  return { handle, published, checks };
}

const request = (path, body, extra = {}) => ({
  method: "POST",
  path,
  headers: { authorization: "Bearer good-token" },
  rawBody: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  ...extra
});

async function quiet(fn) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    const lines = [...out.mock.calls, ...err.mock.calls].map((call) => call.arguments[0]);
    return { result, lines, entries: lines.map((line) => JSON.parse(line)) };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
}

describe("web proxy handler", () => {
  test("publishes a pixel as a web.draw event and answers 202", async () => {
    const { handle, published, checks } = setup();
    const { result: res } = await quiet(() => handle(request("/pixels", { x: 10, y: 20, color: "red", author: "mallory" })));

    assert.equal(res.statusCode, 202);
    assert.deepEqual(JSON.parse(res.body), { accepted: 1 });
    assert.match(res.headers["x-correlation-id"], UUID);
    assert.deepEqual(checks, [{ userId: ALICE.user_id, area: 1 }]);
    assert.deepEqual(published, [{
      type: "web.draw",
      source: "web",
      user_id: ALICE.user_id,
      username: "Alice",
      rect: { x0: 10, y0: 20, x1: 11, y1: 21 },
      color: "#e50000",
      request_id: res.headers["x-correlation-id"],
      requested_at: NOW.toISOString(),
      correlation_id: res.headers["x-correlation-id"]
    }]);
  });

  test("publishes a brush as one rectangle and answers with what fits in the quota", async () => {
    const { handle, published, checks } = setup({ check: { status: "ok", accepted: 7 } });
    const { result: res } = await quiet(() => handle(request("/api/brush", { x: 10, y: 10, color: "#00ff00", size: 4 })));

    assert.equal(res.statusCode, 202);
    assert.deepEqual(JSON.parse(res.body), { accepted: 7 });
    assert.deepEqual(checks[0].area, 16);
    assert.deepEqual(published[0].rect, { x0: 9, y0: 9, x1: 13, y1: 13 });
  });

  test("answers 401 with no Discord user and publishes nothing", async () => {
    const { handle, published } = setup({ authError: new UnauthorizedError("token refused by discord") });
    const { result: res } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));

    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["www-authenticate"], "Bearer");
    assert.equal(published.length, 0);
  });

  test("answers 503 when Discord cannot be reached", async () => {
    const { handle } = setup({ authError: new DiscordUnavailableError("discord answered 502") });
    const { result: res, entries } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));

    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["retry-after"], "5");
    assert.equal(entries[0].severity, "ERROR");
  });

  for (const [label, body] of [
    ["invalid JSON", "{"],
    ["a bad color", { x: 1, y: 1, color: "nope" }],
    ["coordinates outside the grid", { x: 10000, y: 1, color: "red" }],
    ["a body too large", JSON.stringify({ x: 1, y: 1, color: "red", pad: "a".repeat(MAX_BODY_BYTES) })]
  ]) {
    test(`answers 400 to ${label}`, async () => {
      const { handle, published } = setup();
      const { result: res } = await quiet(() => handle(request("/pixels", body)));
      assert.equal(res.statusCode, 400);
      assert.ok(JSON.parse(res.body).error);
      assert.equal(published.length, 0);
    });
  }

  test("answers 400 to a brush without a valid size", async () => {
    const { handle } = setup();
    const { result: res } = await quiet(() => handle(request("/brush", { x: 1, y: 1, color: "red", size: 99 })));
    assert.equal(res.statusCode, 400);
  });

  test("answers 423 while drawing is paused", async () => {
    const { handle, published } = setup({ check: { status: "paused" } });
    const { result: res } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));
    assert.equal(res.statusCode, 423);
    assert.equal(published.length, 0);
  });

  test("answers 429 with Retry-After when the quota is used up", async () => {
    const { handle, published } = setup({ check: { status: "rate_limited", limit: 20, retryAfterSeconds: 42 } });
    const { result: res } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["retry-after"], "42");
    assert.deepEqual(JSON.parse(res.body), { error: "rate limited", limit: 20, retry_after: 42 });
    assert.equal(published.length, 0);
  });

  test("answers 500 and logs an ERROR when publishing fails", async () => {
    const { handle } = setup({ publishError: new Error("pubsub down") });
    const { result: res, entries } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));

    assert.equal(res.statusCode, 500);
    const entry = entries.find((e) => e.message === "failed to publish web draw");
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
  });

  test("answers 404 to an unknown path and 405 to another method", async () => {
    const { handle } = setup();
    assert.equal((await handle(request("/tiles/0/0", {}))).statusCode, 404);
    const res = await handle(request("/pixels", {}, { method: "GET" }));
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
  });

  test("logs one line per draw with the user and correlation id, never the token", async () => {
    const { handle } = setup();
    const { result: res, lines, entries } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));

    const entry = entries.find((e) => e.message === "web draw published");
    assert.equal(entry.user_id, ALICE.user_id);
    assert.equal(entry.correlation_id, res.headers["x-correlation-id"]);
    assert.equal(entry.message_id, "msg-1");
    assert.ok(!lines.join("\n").includes("good-token"));
  });

  test("gives every request its own correlation id", async () => {
    const { handle } = setup();
    const { result: a } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));
    const { result: b } = await quiet(() => handle(request("/pixels", { x: 1, y: 1, color: "red" })));
    assert.notEqual(a.headers["x-correlation-id"], b.headers["x-correlation-id"]);
  });
});
