const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, DRAW_PAUSED, drawn, rateLimited } = require("./handlers");
const { INVALID_COORDINATES, INVALID_COLOR } = require("./draw");
const { snowflakeTime } = require("./snowflake");

const INTERACTION_ID = "1300000000000000000";

function make({ result = { status: "drawn", superseded: false, limit: 20, remaining: 19 }, limit = 20, pixelsError } = {}) {
  const calls = [];
  const limits = {
    limitFor: async (user) => {
      calls.push({ limitFor: user });
      return limit;
    }
  };
  const pixels = {
    draw: async (request) => {
      if (pixelsError) throw pixelsError;
      calls.push({ draw: request });
      return result;
    }
  };
  const discord = { editOriginal: async (event, message) => calls.push({ reply: message.content }) };
  const handlers = createHandlers({ state: {}, limits, pixels, discord, now: () => Date.UTC(2026, 9, 29) });
  return { draw: handlers.draw, calls };
}

const drawEvent = (payload = { x: 10, y: 20, color: "Red" }, extra = {}) => ({
  type: "draw",
  payload,
  user_id: "111",
  username: "Alice",
  interaction_id: INTERACTION_ID,
  application_id: "123456789012345678",
  interaction_token: "tok",
  correlation_id: "corr-1",
  ...extra
});

describe("draw handler", () => {
  test("validates, reads the user's limit, draws, then replies", async () => {
    const { draw, calls } = make();
    await draw(drawEvent());

    assert.deepEqual(calls, [
      { limitFor: "111" },
      {
        draw: {
          x: 10,
          y: 20,
          color: "#e50000",
          author: "111",
          authorName: "Alice",
          drawnAt: snowflakeTime(INTERACTION_ID),
          limit: 20
        }
      },
      { reply: drawn({ x: 10, y: 20, color: "#e50000" }, 19) }
    ]);
  });

  test("passes the user's own limit to the transaction", async () => {
    const { draw, calls } = make({ limit: 5 });
    await draw(drawEvent());
    assert.equal(calls[1].draw.limit, 5);
  });

  test("dates the pixel with the moment the user typed the command", async () => {
    const { draw, calls } = make();
    await draw(drawEvent());
    assert.equal(calls[1].draw.drawnAt.toISOString(), snowflakeTime(INTERACTION_ID).toISOString());
  });

  test("falls back to the current time when the interaction id is missing", async () => {
    const { draw, calls } = make();
    await draw(drawEvent(undefined, { interaction_id: undefined }));
    assert.deepEqual(calls[1].draw.drawnAt, new Date(Date.UTC(2026, 9, 29)));
  });

  test("replies the validation error and touches nothing", async () => {
    const { draw, calls } = make();
    await draw(drawEvent({ x: 10000, y: 0, color: "red" }));
    assert.deepEqual(calls, [{ reply: INVALID_COORDINATES }]);
  });

  test("replies the color error and touches nothing", async () => {
    const { draw, calls } = make();
    await draw(drawEvent({ x: 1, y: 1, color: "rouge" }));
    assert.deepEqual(calls, [{ reply: INVALID_COLOR }]);
  });

  test("tells the user when drawing is paused", async () => {
    const { draw, calls } = make({ result: { status: "paused" } });
    await draw(drawEvent());
    assert.deepEqual(calls.at(-1), { reply: DRAW_PAUSED });
  });

  test("tells the user their limit and when to retry", async () => {
    const { draw, calls } = make({ result: { status: "rate_limited", limit: 20, retryAfterSeconds: 42 } });
    await draw(drawEvent());
    assert.deepEqual(calls.at(-1), { reply: rateLimited(20, 42) });
    assert.equal(rateLimited(20, 42), "⏳ Tu as atteint ta limite de 20 pixels par minute. Réessaie dans 42 s.");
  });

  test("writes the success message with the remaining quota", () => {
    assert.equal(
      drawn({ x: 10, y: 20, color: "#e50000" }, 19),
      "🎨 Pixel (10, 20) dessiné en #e50000. Il te reste 19 pixels cette minute."
    );
    assert.match(drawn({ x: 0, y: 0, color: "#000000" }, 1), /1 pixel cette minute/);
    assert.match(drawn({ x: 0, y: 0, color: "#000000" }, 0), /0 pixel cette minute/);
  });

  test("does not reply when Firestore fails, so Pub/Sub retries", async () => {
    const { draw, calls } = make({ pixelsError: new Error("transaction aborted") });
    await assert.rejects(draw(drawEvent()), /transaction aborted/);
    assert.ok(!calls.some((c) => c.reply));
  });
});
