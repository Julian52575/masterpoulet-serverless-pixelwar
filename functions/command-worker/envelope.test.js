const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parsePushMessage, InvalidMessageError } = require("./envelope");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function push(event, extra = {}) {
  return JSON.stringify({
    message: {
      data: encode(event),
      attributes: { type: event.type, correlation_id: event.correlation_id },
      messageId: "msg-1",
      publishTime: "2026-10-28T10:00:00.000Z"
    },
    subscription: "projects/demo/subscriptions/command-worker",
    deliveryAttempt: 2,
    ...extra
  });
}

describe("parsePushMessage", () => {
  test("decodes the event published by the proxy", () => {
    const event = { type: "draw", payload: { x: 1, y: 2, color: "red" }, correlation_id: "abc" };
    const result = parsePushMessage(push(event));

    assert.deepEqual(result.event, event);
    assert.equal(result.messageId, "msg-1");
    assert.deepEqual(result.attributes, { type: "draw", correlation_id: "abc" });
    assert.equal(result.deliveryAttempt, 2);
    assert.equal(result.subscription, "projects/demo/subscriptions/command-worker");
  });

  test("accepts a Buffer body, as received by the HTTP server", () => {
    const result = parsePushMessage(Buffer.from(push({ type: "get" })));
    assert.equal(result.event.type, "get");
  });

  test("keeps non-ASCII characters of the event intact", () => {
    const result = parsePushMessage(push({ type: "draw", payload: { color: "rouge 🎨 éàü" } }));
    assert.equal(result.event.payload.color, "rouge 🎨 éàü");
  });

  test("reads message_id when messageId is absent", () => {
    const body = JSON.stringify({ message: { data: encode({ type: "get" }), message_id: "legacy-7" } });
    assert.equal(parsePushMessage(body).messageId, "legacy-7");
  });

  test("defaults the optional fields", () => {
    const body = JSON.stringify({ message: { data: encode({ type: "get" }) } });
    const result = parsePushMessage(body);
    assert.equal(result.messageId, null);
    assert.deepEqual(result.attributes, {});
    assert.equal(result.deliveryAttempt, null);
    assert.equal(result.subscription, null);
  });

  const invalid = {
    "a body that is not JSON": "not json",
    "an empty body": "",
    "a body without message": JSON.stringify({ subscription: "s" }),
    "a message without data": JSON.stringify({ message: { messageId: "1" } }),
    "data that is not base64 JSON": JSON.stringify({ message: { data: "%%%not-base64%%%" } }),
    "an event that is an array": JSON.stringify({ message: { data: encode([1, 2]) } }),
    "an event without type": JSON.stringify({ message: { data: encode({ payload: {} }) } }),
    "an event whose type is not a string": JSON.stringify({ message: { data: encode({ type: 42 }) } })
  };

  for (const [name, body] of Object.entries(invalid)) {
    test(`rejects ${name} with InvalidMessageError`, () => {
      assert.throws(() => parsePushMessage(body), InvalidMessageError);
    });
  }
});
