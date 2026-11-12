const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  createHandlers,
  PAUSED,
  RESUMED,
  INVALID_USER,
  INVALID_LIMIT,
  limitSet
} = require("./handlers");
const { DiscordApiError } = require("./discord");

const NOW = Date.UTC(2026, 10, 6, 15, 0, 0);
const paused = { pauseChanged: { paused: true, by: "999", at: "2026-11-06T15:00:00.000Z" } };
const resumed = { pauseChanged: { paused: false, by: "999", at: "2026-11-06T15:00:00.000Z" } };

function make({ stateError, limitsError, discordError } = {}) {
  const calls = [];
  const state = {
    setPaused: async (paused, by) => {
      if (stateError) throw stateError;
      calls.push({ setPaused: paused, by });
    }
  };
  const limits = {
    setLimit: async (user, limit, by) => {
      if (limitsError) throw limitsError;
      calls.push({ setLimit: { user, limit, by } });
    }
  };
  const events = {
    pauseChanged: async ({ paused, by, at }) => calls.push({ pauseChanged: { paused, by, at: at.toISOString() } })
  };
  const discord = {
    editOriginal: async (event, message) => {
      if (discordError) throw discordError;
      calls.push({ reply: message.content });
    }
  };
  return { handlers: createHandlers({ state, limits, events, discord, now: () => NOW }), calls };
}

const event = (type, payload = {}) => ({
  type,
  payload,
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
  test("/admin pause stores paused=true, announces it, then replies", async () => {
    const { handlers, calls } = make();
    await handlers["admin.pause"](event("admin.pause"));
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }, paused, { reply: PAUSED }]);
  });

  test("/admin resume stores paused=false, announces it, then replies", async () => {
    const { handlers, calls } = make();
    await handlers["admin.resume"](event("admin.resume"));
    assert.deepEqual(calls, [{ setPaused: false, by: "999" }, resumed, { reply: RESUMED }]);
  });

  test("does not reply when Firestore fails, and lets the worker retry", async () => {
    const { handlers, calls } = make({ stateError: new Error("firestore unavailable") });
    await assert.rejects(handlers["admin.pause"](event("admin.pause")), /firestore unavailable/);
    assert.deepEqual(calls, []);
  });

  test("lets the worker retry when Discord is temporarily unavailable", async () => {
    const { handlers, calls } = make({ discordError: new DiscordApiError(503, "") });
    await assert.rejects(handlers["admin.pause"](event("admin.pause")), DiscordApiError);
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }, paused]);
  });

  test("keeps the pause when the interaction token has expired", async () => {
    const { handlers, calls } = make({ discordError: new DiscordApiError(404, "Unknown Webhook") });
    await silenced(() => handlers["admin.pause"](event("admin.pause")));
    assert.deepEqual(calls, [{ setPaused: true, by: "999" }, paused]);
  });

  test("tells the user how to undo the pause", () => {
    assert.match(PAUSED, /\/admin resume/);
  });
});

describe("admin.ratelimit", () => {
  const ratelimit = (payload) => event("admin.ratelimit", payload);

  test("stores the override for the target user with the admin id, then replies", async () => {
    const { handlers, calls } = make();
    await handlers["admin.ratelimit"](ratelimit({ user: "222", limit: 5 }));
    assert.deepEqual(calls, [
      { setLimit: { user: "222", limit: 5, by: "999" } },
      { reply: limitSet("222", 5) }
    ]);
  });

  test("mentions the user and the limit in the reply", () => {
    assert.equal(limitSet("222", 5), "✅ <@222> can now draw 5 pixels per minute.");
    assert.equal(limitSet("222", 1), "✅ <@222> can now draw 1 pixel per minute.");
  });

  for (const [name, payload] of Object.entries({
    "a missing user": { limit: 5 },
    "a user that is not a Discord id": { user: "alice", limit: 5 },
    "a user given as a number": { user: 222, limit: 5 }
  })) {
    test(`refuses ${name} without writing anything`, async () => {
      const { handlers, calls } = make();
      await handlers["admin.ratelimit"](ratelimit(payload));
      assert.deepEqual(calls, [{ reply: INVALID_USER }]);
    });
  }

  for (const [name, payload] of Object.entries({
    "a missing limit": { user: "222" },
    "a limit of 0": { user: "222", limit: 0 },
    "a negative limit": { user: "222", limit: -3 },
    "a limit above 10000": { user: "222", limit: 10001 },
    "a decimal limit": { user: "222", limit: 2.5 },
    "a limit given as text": { user: "222", limit: "5" }
  })) {
    test(`refuses ${name} without writing anything`, async () => {
      const { handlers, calls } = make();
      await handlers["admin.ratelimit"](ratelimit(payload));
      assert.deepEqual(calls, [{ reply: INVALID_LIMIT }]);
    });
  }

  test("does not reply when Firestore fails, and lets the worker retry", async () => {
    const { handlers, calls } = make({ limitsError: new Error("firestore unavailable") });
    await assert.rejects(handlers["admin.ratelimit"](ratelimit({ user: "222", limit: 5 })), /firestore unavailable/);
    assert.deepEqual(calls, []);
  });

  test("survives a missing payload", async () => {
    const { handlers, calls } = make();
    await handlers["admin.ratelimit"]({ ...ratelimit(), payload: undefined });
    assert.deepEqual(calls, [{ reply: INVALID_USER }]);
  });
});
