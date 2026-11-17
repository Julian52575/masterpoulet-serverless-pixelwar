const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, readCookie, STATE_COOKIE } = require("./handler");
const { InvalidCodeError, DiscordUnavailableError } = require("./oauth");

const APP = "https://pixelwar.example/";
const STATE = "s".repeat(43);

function setup({ exchangeError, userError } = {}) {
  const exchanged = [];
  const oauth = {
    authorizeUrl: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
    exchange: async (code) => {
      exchanged.push(code);
      if (exchangeError) throw exchangeError;
      return { accessToken: "access-token-1", expiresIn: 604800, scope: "identify" };
    },
    fetchUser: async () => {
      if (userError) throw userError;
      return { userId: "42", username: "Alice" };
    }
  };
  return { handle: createHandler({ oauth, appUrl: APP, randomState: () => STATE }), exchanged };
}

const callback = (query, cookie = `${STATE_COOKIE}=${STATE}`) => ({
  method: "GET",
  path: "/api/auth/callback",
  query,
  headers: cookie ? { cookie } : {}
});

const fragment = (res) => Object.fromEntries(new URLSearchParams(new URL(res.headers.location).hash.slice(1)));

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

describe("GET /auth/login", () => {
  test("redirects to Discord and stores the state in a secure cookie", async () => {
    const { handle } = setup();
    const res = await handle({ method: "GET", path: "/api/auth/login" });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `https://discord.com/oauth2/authorize?state=${STATE}`);
    assert.equal(res.headers["set-cookie"], `${STATE_COOKIE}=${STATE}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("uses a new random state each time by default", async () => {
    const handle = createHandler({ oauth: { authorizeUrl: (s) => s }, appUrl: APP });
    const a = await handle({ method: "GET", path: "/auth/login" });
    const b = await handle({ method: "GET", path: "/auth/login" });
    assert.match(a.headers.location, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.headers.location, b.headers.location);
  });
});

describe("GET /auth/callback", () => {
  test("exchanges the code and sends the token back to the app in the URL fragment", async () => {
    const { handle, exchanged } = setup();
    const { result: res } = await quiet(() => handle(callback({ code: "the-code", state: STATE })));

    assert.equal(res.statusCode, 302);
    assert.ok(res.headers.location.startsWith(`${APP}#`));
    assert.deepEqual(fragment(res), { access_token: "access-token-1", token_type: "Bearer", expires_in: "604800" });
    assert.deepEqual(exchanged, ["the-code"]);
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("logs the Discord user id but never the token or the code", async () => {
    const { handle } = setup();
    const { lines, entries } = await quiet(() => handle(callback({ code: "the-code", state: STATE })));

    assert.equal(entries.find((e) => e.message === "discord login").user_id, "42");
    assert.ok(!lines.join("\n").includes("access-token-1"));
    assert.ok(!lines.join("\n").includes("the-code"));
  });

  for (const [label, query, cookie] of [
    ["no state cookie", { code: "c", state: STATE }, null],
    ["a different state", { code: "c", state: "t".repeat(43) }, undefined],
    ["no state in the URL", { code: "c" }, undefined],
    ["a state given twice", { code: "c", state: [STATE, STATE] }, undefined]
  ]) {
    test(`refuses ${label} (CSRF) without calling Discord`, async () => {
      const { handle, exchanged } = setup();
      const { result: res } = await quiet(() => handle(callback(query, cookie)));
      assert.deepEqual(fragment(res), { auth_error: "invalid_state" });
      assert.equal(exchanged.length, 0);
    });
  }

  test("sends the user back when they refused on Discord", async () => {
    const { handle, exchanged } = setup();
    const { result: res } = await quiet(() => handle(callback({ error: "access_denied", state: STATE })));
    assert.deepEqual(fragment(res), { auth_error: "access_denied" });
    assert.equal(exchanged.length, 0);
  });

  test("refuses a malformed code", async () => {
    const { handle, exchanged } = setup();
    const { result: res } = await quiet(() => handle(callback({ code: "<script>", state: STATE })));
    assert.deepEqual(fragment(res), { auth_error: "invalid_code" });
    assert.equal(exchanged.length, 0);
  });

  test("reports a code Discord refuses", async () => {
    const { handle } = setup({ exchangeError: new InvalidCodeError("refused") });
    const { result: res } = await quiet(() => handle(callback({ code: "used", state: STATE })));
    assert.deepEqual(fragment(res), { auth_error: "invalid_code" });
  });

  test("reports Discord as unavailable and logs an ERROR", async () => {
    const { handle } = setup({ userError: new DiscordUnavailableError("502") });
    const { result: res, entries } = await quiet(() => handle(callback({ code: "c", state: STATE })));
    assert.deepEqual(fragment(res), { auth_error: "discord_unavailable" });
    assert.equal(entries.at(-1).severity, "ERROR");
  });
});

describe("routing", () => {
  test("answers 404 to an unknown path and 405 to a POST", async () => {
    const { handle } = setup();
    assert.equal((await handle({ method: "GET", path: "/auth/other" })).statusCode, 404);
    assert.equal((await handle({ method: "POST", path: "/auth/login" })).statusCode, 405);
  });
});

describe("readCookie", () => {
  test("finds one cookie among several", () => {
    assert.equal(readCookie("a=1; __Host-x=abc==; b=2", "__Host-x"), "abc==");
    assert.equal(readCookie(undefined, "a"), null);
  });
});

describe("correlation id", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test("every answer carries one, even errors", async () => {
    const { handle } = setup();
    const answers = await quiet(async () => [
      await handle({ method: "GET", path: "/api/auth/login" }),
      await handle(callback({ code: "abc", state: STATE })),
      await handle(callback({ code: "abc", state: STATE }, null)),
      await handle({ method: "POST", path: "/api/auth/login" }),
      await handle({ method: "GET", path: "/api/nope" })
    ]);
    for (const res of answers.result) assert.match(res.headers["x-correlation-id"], UUID);
  });

  test("keeps the one sent by the browser and puts it in every log line", async () => {
    const { handle } = setup();
    const request = callback({ code: "abc", state: STATE });
    request.headers["x-correlation-id"] = "web-login-1234";
    const { result: res, entries } = await quiet(() => handle(request));

    assert.equal(res.headers["x-correlation-id"], "web-login-1234");
    assert.ok(entries.length > 0);
    for (const entry of entries) assert.equal(entry.correlation_id, "web-login-1234");
  });

  test("logs a failed login with its correlation id", async () => {
    const { handle } = setup({ exchangeError: new DiscordUnavailableError("timeout") });
    const { result: res, entries } = await quiet(() => handle(callback({ code: "abc", state: STATE })));
    const failure = entries.find((entry) => entry.message === "discord login failed");
    assert.equal(failure.correlation_id, res.headers["x-correlation-id"]);
  });
});
