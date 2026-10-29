const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createReplier } = require("./reply");
const { DiscordApiError } = require("./discord");

const event = { type: "admin.pause", correlation_id: "corr-1", interaction_token: "secret-token" };

function capture(fn) {
  const out = mock.method(console, "log", () => {});
  return fn()
    .then((result) => ({ result, lines: out.mock.calls.map((call) => call.arguments[0]) }))
    .finally(() => out.mock.restore());
}

describe("reply", () => {
  test("edits the original response with the given text", async () => {
    const sent = [];
    const reply = createReplier({ discord: { editOriginal: async (e, m) => sent.push([e, m]) } });
    await reply(event, "OK");
    assert.deepEqual(sent, [[event, { content: "OK" }]]);
  });

  test("rethrows a retryable Discord error so Pub/Sub retries", async () => {
    const reply = createReplier({ discord: { editOriginal: async () => { throw new DiscordApiError(429, ""); } } });
    await assert.rejects(reply(event, "OK"), (e) => e.status === 429);
  });

  test("logs and swallows a non-retryable Discord error", async () => {
    const reply = createReplier({ discord: { editOriginal: async () => { throw new DiscordApiError(404, "Unknown Webhook"); } } });
    const { lines } = await capture(() => reply(event, "OK"));
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.message, "could not reply to the user");
    assert.equal(entry.status, 404);
    assert.equal(entry.correlation_id, "corr-1");
    assert.ok(!lines.join("\n").includes("secret-token"));
  });
});
