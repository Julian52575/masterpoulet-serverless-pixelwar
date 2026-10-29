const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, PAUSED, RESUMED } = require("./handlers");
const { DiscordApiError } = require("./discord");

function make({ stateError, discordError } = {}) {
  const calls = [];
  const state = {
    setPaused: async (paused, by) => {
      if (stateError) throw stateError;
      calls.push({ setPaused: paused, by });
    }
  };
  const discord = {
    editOriginal: async (event, message) => {
      if (discordError) throw discordError;
      calls.push({ reply: message.content });
    }
  };
  return { handlers: createHandlers({ state, discord }), calls };
}

const event = (type) => ({
  type,
  user_id: "999",
  application_id: "123456789012345678",
  interaction_token: "tok",
  correlation_id: "corr-1"
});

function silenced(fn) {
  const out = mock.method(console, "log", () => {});
  return fn().finally(() => out.mock.restore());
}

describe("admin.pause / admin.resume", () => {
  test("/admin pause stores paused=true with the admin id, then replies", async () => {
    const { handlers, calls } = make();
    await handlers["admin.pause"](event("admin.pause"));
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }, { reply: PAUSED }]);
  });

  test("/admin resume stores paused=false with the admin id, then replies", async () => {
    const { handlers, calls } = make();
    await handlers["admin.resume"](event("admin.resume"));
    assert.deepEqual(calls, [{ setPaused: false, by: "999" }, { reply: RESUMED }]);
  });

  test("does not reply when Firestore fails, and lets the worker retry", async () => {
    const { handlers, calls } = make({ stateError: new Error("firestore unavailable") });
    await assert.rejects(handlers["admin.pause"](event("admin.pause")), /firestore unavailable/);
    assert.deepEqual(calls, []);
  });

  test("lets the worker retry when Discord is temporarily unavailable", async () => {
    const { handlers, calls } = make({ discordError: new DiscordApiError(503, "") });
    await assert.rejects(handlers["admin.pause"](event("admin.pause")), DiscordApiError);
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }]);
  });

  test("keeps the pause when the interaction token has expired", async () => {
    const { handlers, calls } = make({ discordError: new DiscordApiError(404, "Unknown Webhook") });
    await silenced(() => handlers["admin.pause"](event("admin.pause")));
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }]);
  });

  test("tells the user how to undo the pause", () => {
    assert.match(PAUSED, /\/admin resume/);
  });
});
