const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createDiscordAuth, hashToken, UnauthorizedError, DiscordUnavailableError, USERS_ME } = require("./auth");

function fakeDiscord(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, authorization: options.headers.authorization });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}

const ALICE = { status: 200, body: { id: "123456789012345678", username: "alice", global_name: "Alice" } };

describe("createDiscordAuth", () => {
  test("asks Discord who owns the token", async () => {
    const discord = fakeDiscord([ALICE]);
    const { authenticate } = createDiscordAuth({ fetch: discord.fetch });

    assert.deepEqual(await authenticate("Bearer abc.DEF-123"), { user_id: "123456789012345678", username: "Alice", cached: false });
    assert.deepEqual(discord.calls, [{ url: USERS_ME, authorization: "Bearer abc.DEF-123" }]);
  });

  test("falls back to the username when there is no display name", async () => {
    const discord = fakeDiscord([{ status: 200, body: { id: "1", username: "bob", global_name: null } }]);
    const user = await createDiscordAuth({ fetch: discord.fetch }).authenticate("Bearer t");
    assert.equal(user.username, "bob");
  });

  test("caches the user, so Discord is asked only once per token", async () => {
    const discord = fakeDiscord([ALICE]);
    const { authenticate } = createDiscordAuth({ fetch: discord.fetch });

    await authenticate("Bearer t");
    const second = await authenticate("Bearer t");

    assert.equal(second.cached, true);
    assert.equal(discord.calls.length, 1);
  });

  test("asks Discord again once the cache entry expired", async () => {
    let clock = 0;
    const discord = fakeDiscord([ALICE, ALICE]);
    const { authenticate } = createDiscordAuth({ fetch: discord.fetch, now: () => clock, ttlMs: 1000 });

    await authenticate("Bearer t");
    clock = 1000;
    await authenticate("Bearer t");

    assert.equal(discord.calls.length, 2);
  });

  test("keeps the cache bounded by dropping the oldest entries", async () => {
    const discord = fakeDiscord([ALICE, ALICE, ALICE]);
    const auth = createDiscordAuth({ fetch: discord.fetch, maxEntries: 2 });

    await auth.authenticate("Bearer a");
    await auth.authenticate("Bearer b");
    await auth.authenticate("Bearer c");

    assert.equal(auth.size(), 2);
  });

  for (const header of [undefined, "", "abc", "Basic abc", "Bearer ", "Bearer a b", `Bearer ${"a".repeat(300)}`]) {
    test(`refuses the header ${JSON.stringify(header)?.slice(0, 20)} without calling Discord`, async () => {
      const discord = fakeDiscord([]);
      await assert.rejects(createDiscordAuth({ fetch: discord.fetch }).authenticate(header), UnauthorizedError);
      assert.equal(discord.calls.length, 0);
    });
  }

  for (const status of [401, 403]) {
    test(`refuses a token Discord answers ${status} to, and does not cache it`, async () => {
      const discord = fakeDiscord([{ status }, ALICE]);
      const { authenticate } = createDiscordAuth({ fetch: discord.fetch });

      await assert.rejects(authenticate("Bearer t"), UnauthorizedError);
      assert.equal((await authenticate("Bearer t")).cached, false);
    });
  }

  for (const [label, response] of [
    ["a 429", { status: 429 }],
    ["a 500", { status: 500 }],
    ["a network error", new Error("ECONNRESET")],
    ["a body with no id", { status: 200, body: {} }]
  ]) {
    test(`reports Discord as unavailable on ${label}`, async () => {
      const discord = fakeDiscord([response]);
      await assert.rejects(createDiscordAuth({ fetch: discord.fetch }).authenticate("Bearer t"), DiscordUnavailableError);
    });
  }

  test("keys the cache by a SHA-256 hash, never by the raw token", () => {
    const key = hashToken("secret-token");
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes("secret-token"));
  });
});
