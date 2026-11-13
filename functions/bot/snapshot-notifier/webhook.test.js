const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createChannelWebhook, isWebhookUrl, DiscordApiError } = require("./discord");

const URL = "https://discord.com/api/webhooks/123456789012345678/tok_EN-1";

function fakeFetch(status) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: status < 300, status, text: async () => "body" };
  };
  return { fetch, calls };
}

describe("createChannelWebhook", () => {
  test("posts the message to the channel webhook, with mentions disabled", async () => {
    const { fetch, calls } = fakeFetch(200);
    await createChannelWebhook({ url: URL, fetch }).post({ content: "hello @everyone" });

    assert.equal(calls[0].url, `${URL}?wait=true`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].body), { allowed_mentions: { parse: [] }, content: "hello @everyone" });
  });

  test("marks 429 and 5xx answers as retryable, and 4xx as final", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [404, false]]) {
      const { fetch } = fakeFetch(status);
      const error = await createChannelWebhook({ url: URL, fetch }).post({ content: "x" }).catch((e) => e);
      assert.ok(error instanceof DiscordApiError);
      assert.equal(error.retryable, retryable);
      assert.ok(!error.message.includes("tok_EN-1"), "the webhook token must not end up in logs");
    }
  });

  test("refuses to be built with something that is not a Discord webhook URL", () => {
    assert.throws(() => createChannelWebhook({ url: "https://evil.example/api/webhooks/1/x" }), /invalid Discord webhook URL/);
  });

  test("recognises the Discord webhook URL forms", () => {
    assert.equal(isWebhookUrl(URL), true);
    assert.equal(isWebhookUrl("https://canary.discord.com/api/v10/webhooks/1/x"), true);
    assert.equal(isWebhookUrl("https://discordapp.com/api/webhooks/1/x"), true);
    assert.equal(isWebhookUrl(undefined), false);
  });
});
