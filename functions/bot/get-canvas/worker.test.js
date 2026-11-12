const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function push(event, deliveryAttempt = 1) {
  return Buffer.from(JSON.stringify({
    message: { data: encode(event), messageId: "msg-1" },
    subscription: "projects/demo/subscriptions/get-canvas",
    deliveryAttempt
  }));
}

const getEvent = {
  type: "get",
  user_id: "111",
  roles: [],
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
  test("runs /get for any user and acks with 204", async () => {
    const received = [];
    const handle = createWorker({ handlers: { get: async (event) => { received.push(event); } } });

    const { result } = await captureLogs(() => handle(push(getEvent)));

    assert.equal(result.statusCode, 204);
    assert.deepEqual(received, [getEvent]);
  });

  for (const type of ["draw", "web.draw", "snapshot", "admin.pause", "admin.clear", "toString"]) {
    test(`rejects ${type} with 400 so it ends up in the DLQ`, async () => {
      const handle = createWorker({ handlers: { get: async () => {} } });
      const { result } = await captureLogs(() => handle(push({ ...getEvent, type })));
      assert.equal(result.statusCode, 400);
    });
  }

  test("rejects a malformed push message with 400", async () => {
    const handle = createWorker({ handlers: { get: async () => {} } });
    const { result, entries } = await captureLogs(() => handle(Buffer.from("not json")));
    assert.equal(result.statusCode, 400);
    assert.equal(entries[0].message, "invalid pubsub push message");
  });

  test("answers 500 when Firestore fails, so Pub/Sub retries", async () => {
    const handle = createWorker({ handlers: { get: async () => { throw new Error("firestore down"); } } });
    const { result, entries } = await captureLogs(() => handle(push(getEvent, 2)));

    assert.equal(result.statusCode, 500);
    const entry = entries.find((e) => e.message === "command failed");
    assert.equal(entry.function, "get-canvas");
    assert.equal(entry.correlation_id, "corr-1");
    assert.equal(entry.delivery_attempt, 2);
  });

  test("never writes the interaction token to the logs", async () => {
    const handle = createWorker({ handlers: { get: async () => { throw new Error("boom"); } } });
    const { lines } = await captureLogs(() => handle(push(getEvent)));
    assert.ok(!lines.join("\n").includes("secret-interaction-token"));
  });
});

describe("createHandlers", () => {
  test("only handles /get", () => {
    assert.deepEqual(Object.keys(createHandlers({})), ["get"]);
  });
});
