const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createDiscordClient, DiscordApiError } = require("./discord");

const event = {
  application_id: "123456789012345678",
  interaction_token: "aW50ZXJhY3Rpb246MTIz.abc_DEF-ghi"
};

function fakeFetch(status = 204, text = "") {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

describe("editOriginal", () => {
  test("PATCHes the original interaction response through the webhook URL", async () => {
    const { fetch, calls } = fakeFetch();
    await createDiscordClient({ fetch }).editOriginal(event, { content: "Pixel dessiné" });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://discord.com/api/v10/webhooks/123456789012345678/aW50ZXJhY3Rpb246MTIz.abc_DEF-ghi/messages/@original"
    );
    assert.equal(calls[0].init.method, "PATCH");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test("sends the message and blocks every mention by default", async () => {
    const { fetch, calls } = fakeFetch();
    await createDiscordClient({ fetch }).editOriginal(event, { content: "@everyone salut" });

    assert.deepEqual(JSON.parse(calls[0].init.body), {
      allowed_mentions: { parse: [] },
      content: "@everyone salut"
    });
  });

  test("lets the caller pass embeds and override allowed_mentions", async () => {
    const { fetch, calls } = fakeFetch();
    const message = {
      embeds: [{ title: "Snapshot" }],
      allowed_mentions: { users: ["111"] }
    };
    await createDiscordClient({ fetch }).editOriginal(event, message);
    assert.deepEqual(JSON.parse(calls[0].init.body), message);
  });

  test("uses the configured base URL", async () => {
    const { fetch, calls } = fakeFetch();
    await createDiscordClient({ fetch, baseUrl: "http://127.0.0.1:9999/api" }).editOriginal(event, { content: "x" });
    assert.ok(calls[0].url.startsWith("http://127.0.0.1:9999/api/webhooks/"));
  });

  test("does not need the bot token: no Authorization header is sent", async () => {
    const { fetch, calls } = fakeFetch();
    await createDiscordClient({ fetch }).editOriginal(event, { content: "x" });
    assert.equal(calls[0].init.headers.authorization, undefined);
    assert.equal(calls[0].init.headers.Authorization, undefined);
  });

  test("throws a non-retryable DiscordApiError when the token expired (404)", async () => {
    const { fetch } = fakeFetch(404, '{"message":"Unknown Webhook","code":10015}');
    await assert.rejects(
      createDiscordClient({ fetch }).editOriginal(event, { content: "x" }),
      (error) => {
        assert.ok(error instanceof DiscordApiError);
        assert.equal(error.status, 404);
        assert.equal(error.retryable, false);
        assert.match(error.body, /Unknown Webhook/);
        return true;
      }
    );
  });

  for (const status of [429, 500, 502, 503]) {
    test(`marks a ${status} response as retryable`, async () => {
      const { fetch } = fakeFetch(status);
      await assert.rejects(
        createDiscordClient({ fetch }).editOriginal(event, { content: "x" }),
        (error) => error instanceof DiscordApiError && error.retryable === true
      );
    });
  }

  test("marks a 400 response as not retryable", async () => {
    const { fetch } = fakeFetch(400, '{"message":"Invalid Form Body"}');
    await assert.rejects(
      createDiscordClient({ fetch }).editOriginal(event, { content: "x" }),
      (error) => error instanceof DiscordApiError && error.retryable === false
    );
  });

  test("does not put the interaction token in the error message", async () => {
    const { fetch } = fakeFetch(500);
    await assert.rejects(
      createDiscordClient({ fetch }).editOriginal(event, { content: "x" }),
      (error) => !error.message.includes(event.interaction_token)
    );
  });

  const forged = {
    "an application id that is not a snowflake": { ...event, application_id: "../../users/@me" },
    "a missing application id": { interaction_token: event.interaction_token },
    "a token with a path separator": { ...event, interaction_token: "abc/../../guilds" },
    "a token with a query string": { ...event, interaction_token: "abc?wait=true" },
    "a missing token": { application_id: event.application_id }
  };

  for (const [name, bad] of Object.entries(forged)) {
    test(`refuses ${name} without calling Discord`, async () => {
      const { fetch, calls } = fakeFetch();
      await assert.rejects(createDiscordClient({ fetch }).editOriginal(bad, { content: "x" }));
      assert.equal(calls.length, 0);
    });
  }
});
