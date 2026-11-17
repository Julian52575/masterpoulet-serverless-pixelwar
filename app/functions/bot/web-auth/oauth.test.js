const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createDiscordOAuth, InvalidCodeError, DiscordUnavailableError, TOKEN_URL, USERS_ME } = require("./oauth");

const CONFIG = { clientId: "123", clientSecret: "s3cret", redirectUri: "https://pixelwar.example/api/auth/callback" };

function fakeDiscord(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}

const TOKEN = { status: 200, body: { access_token: "tok", token_type: "Bearer", expires_in: 604800, scope: "identify" } };

describe("authorizeUrl", () => {
  test("asks for the identify scope only, with our redirect URI and state", () => {
    const url = new URL(createDiscordOAuth(CONFIG).authorizeUrl("the-state"));
    assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      response_type: "code",
      client_id: "123",
      scope: "identify",
      redirect_uri: CONFIG.redirectUri,
      state: "the-state"
    });
  });
});

describe("exchange", () => {
  test("posts the code with the client credentials in a Basic header", async () => {
    const discord = fakeDiscord([TOKEN]);
    const result = await createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).exchange("abc");

    assert.deepEqual(result, { accessToken: "tok", expiresIn: 604800, scope: "identify" });
    const [call] = discord.calls;
    assert.equal(call.url, TOKEN_URL);
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, `Basic ${Buffer.from("123:s3cret").toString("base64")}`);
    assert.equal(call.headers["content-type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(call.body)), {
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: CONFIG.redirectUri
    });
  });

  test("never puts the client secret in the body", async () => {
    const discord = fakeDiscord([TOKEN]);
    await createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).exchange("abc");
    assert.ok(!discord.calls[0].body.includes("s3cret"));
  });

  for (const status of [400, 401]) {
    test(`reports a refused code on ${status}`, async () => {
      const discord = fakeDiscord([{ status, body: { error: "invalid_grant" } }]);
      await assert.rejects(createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).exchange("x"), InvalidCodeError);
    });
  }

  test("refuses a token without the identify scope", async () => {
    const discord = fakeDiscord([{ status: 200, body: { ...TOKEN.body, scope: "email" } }]);
    await assert.rejects(createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).exchange("x"), InvalidCodeError);
  });

  for (const [label, response] of [
    ["a 500", { status: 500 }],
    ["a 429", { status: 429 }],
    ["a network error", new Error("ETIMEDOUT")],
    ["a body without a token", { status: 200, body: { token_type: "Bearer" } }]
  ]) {
    test(`reports Discord as unavailable on ${label}`, async () => {
      const discord = fakeDiscord([response]);
      await assert.rejects(createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).exchange("x"), DiscordUnavailableError);
    });
  }
});

describe("fetchUser", () => {
  test("reads the Discord user id and display name", async () => {
    const discord = fakeDiscord([{ status: 200, body: { id: "42", username: "alice", global_name: "Alice" } }]);
    const user = await createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).fetchUser("tok");

    assert.deepEqual(user, { userId: "42", username: "Alice" });
    assert.equal(discord.calls[0].url, USERS_ME);
    assert.equal(discord.calls[0].headers.authorization, "Bearer tok");
  });

  test("reports Discord as unavailable when it does not answer with a user", async () => {
    const discord = fakeDiscord([{ status: 502 }]);
    await assert.rejects(createDiscordOAuth({ ...CONFIG, fetch: discord.fetch }).fetchUser("tok"), DiscordUnavailableError);
  });
});
