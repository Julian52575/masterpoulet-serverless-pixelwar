const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createWorker } = require("./worker");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function push(event, deliveryAttempt = 1) {
  return Buffer.from(JSON.stringify({
    message: { data: encode(event), messageId: "msg-1" },
    subscription: "projects/demo/subscriptions/command-worker",
    deliveryAttempt
  }));
}

const drawEvent = {
  type: "draw",
  payload: { x: 10, y: 20, color: "#ff0000" },
  user_id: "111",
  interaction_id: "interaction-1",
  interaction_token: "secret-interaction-token",
  correlation_id: "corr-1"
};

async function captureLogs(fn) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await fn();
    const lines = [...out.mock.calls, ...err.mock.calls].map((call) => call.arguments[0]);
    return { result, lines, entries: lines.map((line) => JSON.parse(line)) };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
}

describe("createWorker", () => {
  test("routes the event to the handler of its type and acks with 204", async () => {
    const received = [];
    const handle = createWorker({ handlers: { draw: async (event) => { received.push(event); } } });

    const { result } = await captureLogs(() => handle(push(drawEvent)));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(received, [drawEvent]);
  });

  test("only calls the handler matching the type", async () => {
    const calls = [];
    const handle = createWorker({
      handlers: {
        draw: async () => calls.push("draw"),
        get: async () => calls.push("get")
      }
    });
    await captureLogs(() => handle(push({ type: "get" })));
    assert.deepEqual(calls, ["get"]);
  });

  test("rejects an unknown command type with 400 so it ends up in the DLQ", async () => {
    const handle = createWorker({ handlers: { draw: async () => {} } });
    const { result, entries } = await captureLogs(() => handle(push({ type: "hack", correlation_id: "c" })));

    assert.equal(result.statusCode, 400);
    const entry = entries.find((e) => e.message === "unsupported command type");
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.command, "hack");
    assert.equal(entry.correlation_id, "c");
  });

  test("does not treat inherited object keys as handlers", async () => {
    const handle = createWorker({ handlers: {} });
    const { result } = await captureLogs(() => handle(push({ type: "toString" })));
    assert.equal(result.statusCode, 400);
  });

  test("rejects a malformed push message with 400", async () => {
    const handle = createWorker({ handlers: { draw: async () => {} } });
    const { result, entries } = await captureLogs(() => handle(Buffer.from("not json")));

    assert.equal(result.statusCode, 400);
    assert.equal(entries[0].message, "invalid pubsub push message");
    assert.equal(entries[0].error, "body is not valid JSON");
  });

  test("answers 500 when the handler fails, so Pub/Sub retries", async () => {
    const handle = createWorker({ handlers: { draw: async () => { throw new Error("firestore down"); } } });
    const { result, entries } = await captureLogs(() => handle(push(drawEvent, 3)));

    assert.equal(result.statusCode, 500);
    const entry = entries.find((e) => e.message === "command failed");
    assert.equal(entry.severity, "ERROR");
    assert.equal(entry.error, "firestore down");
    assert.equal(entry.correlation_id, "corr-1");
    assert.equal(entry.delivery_attempt, 3);
    assert.equal(typeof entry.duration_ms, "number");
  });

  test("logs the received and processed command with the correlation id", async () => {
    const handle = createWorker({ handlers: { draw: async () => {} } });
    const { entries } = await captureLogs(() => handle(push(drawEvent, 2)));

    const received = entries.find((e) => e.message === "command received");
    assert.equal(received.severity, "INFO");
    assert.equal(received.function, "command-worker");
    assert.equal(received.correlation_id, "corr-1");
    assert.equal(received.command, "draw");
    assert.equal(received.user_id, "111");
    assert.equal(received.interaction_id, "interaction-1");
    assert.equal(received.message_id, "msg-1");
    assert.equal(received.delivery_attempt, 2);

    const processed = entries.find((e) => e.message === "command processed");
    assert.equal(processed.correlation_id, "corr-1");
    assert.equal(typeof processed.duration_ms, "number");
  });

  test("never writes the interaction token to the logs", async () => {
    const handle = createWorker({ handlers: { draw: async () => { throw new Error("boom"); } } });
    const { lines } = await captureLogs(() => handle(push(drawEvent)));
    assert.ok(!lines.join("\n").includes("secret-interaction-token"));
  });
});
