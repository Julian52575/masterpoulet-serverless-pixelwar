const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, cleared } = require("./handlers");
const { snowflakeTime } = require("./snowflake");

const INTERACTION_ID = "1300000000000000000";

function make({ deleted = 42, cleanerError, eventsError } = {}) {
  const calls = [];
  const state = { setCleared: async (at, by) => calls.push({ setCleared: { at, by } }) };
  const cleaner = {
    clearBefore: async (at) => {
      if (cleanerError) throw cleanerError;
      calls.push({ clearBefore: at });
      return deleted;
    }
  };
  const events = {
    canvasCleared: async (event) => {
      if (eventsError) throw eventsError;
      calls.push({ publish: event });
    }
  };
  const discord = { editOriginal: async (event, message) => calls.push({ reply: message.content }) };
  const handlers = createHandlers({ state, cleaner, events, discord, now: () => Date.UTC(2026, 9, 29) });
  return { clear: handlers["admin.clear"], calls };
}

const clearEvent = (extra = {}) => ({
  type: "admin.clear",
  payload: {},
  user_id: "999",
  interaction_id: INTERACTION_ID,
  application_id: "123456789012345678",
  interaction_token: "tok",
  correlation_id: "corr-9",
  ...extra
});

describe("admin.clear", () => {
  test("records the clear time, deletes the old pixels, announces it, then replies", async () => {
    const { clear, calls } = make();
    await clear(clearEvent());
    const at = snowflakeTime(INTERACTION_ID);

    assert.deepEqual(calls, [
      { setCleared: { at, by: "999" } },
      { clearBefore: at },
      { publish: { clearedAt: at, clearedBy: "999", correlationId: "corr-9" } },
      { reply: cleared(42) }
    ]);
  });

  test("uses the moment the admin typed the command, so a replay clears the same pixels", async () => {
    const { clear, calls } = make();
    await clear(clearEvent());
    assert.deepEqual(calls[0].setCleared.at, snowflakeTime(INTERACTION_ID));
  });

  test("falls back to the current time without an interaction id", async () => {
    const { clear, calls } = make();
    await clear(clearEvent({ interaction_id: undefined }));
    assert.deepEqual(calls[0].setCleared.at, new Date(Date.UTC(2026, 9, 29)));
  });

  test("tells how many pixels were deleted", () => {
    assert.equal(cleared(42), "🧹 La grille a été effacée (42 pixels supprimés).");
    assert.equal(cleared(1), "🧹 La grille a été effacée (1 pixel supprimé).");
    assert.equal(cleared(0), "🧹 La grille a été effacée (0 pixel supprimé).");
  });

  test("does not announce nor reply when the deletion fails, so Pub/Sub retries", async () => {
    const { clear, calls } = make({ cleanerError: new Error("deadline exceeded") });
    await assert.rejects(clear(clearEvent()), /deadline exceeded/);
    assert.deepEqual(calls.map((c) => Object.keys(c)[0]), ["setCleared"]);
  });

  test("does not reply when the announcement fails, so Pub/Sub retries", async () => {
    const { clear, calls } = make({ eventsError: new Error("pubsub unavailable") });
    await assert.rejects(clear(clearEvent()), /pubsub unavailable/);
    assert.ok(!calls.some((c) => c.reply));
  });
});
