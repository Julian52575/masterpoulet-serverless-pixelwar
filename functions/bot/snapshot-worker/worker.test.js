const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createWorker } = require("./worker");
const { InvalidRequestError } = require("./snapshot");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const push = (event, deliveryAttempt = 1) =>
  Buffer.from(JSON.stringify({ message: { data: encode(event), messageId: "m-1" }, deliveryAttempt }));

const event = {
  type: "snapshot.requested",
  snapshot_id: "42",
  requested_at: "2026-10-29T12:00:00.000Z",
  requested_by: "999",
  interaction_token: "secret-token",
  correlation_id: "corr-7"
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

describe("snapshot worker", () => {
  test("acks with 204 once the snapshot is stored, and logs where", async () => {
    const handle = createWorker({ takeSnapshot: async () => ({ name: "snapshots/x.png", count: 3, bytes: 99 }) });
    const { result, entries } = await captureLogs(() => handle(push(event)));

    assert.equal(result.statusCode, 204);
    const stored = entries.find((e) => e.message === "snapshot stored");
    assert.equal(stored.function, "snapshot-worker");
    assert.equal(stored.correlation_id, "corr-7");
    assert.equal(stored.snapshot_id, "42");
    assert.equal(stored.object, "snapshots/x.png");
    assert.equal(stored.pixel_count, 3);
  });

  test("answers 500 when Firestore or Cloud Storage fails, so Pub/Sub retries", async () => {
    const handle = createWorker({ takeSnapshot: async () => { throw new Error("503 backend error"); } });
    const { result, entries } = await captureLogs(() => handle(push(event, 2)));

    assert.equal(result.statusCode, 500);
    const failed = entries.find((e) => e.message === "snapshot failed");
    assert.equal(failed.severity, "ERROR");
    assert.equal(failed.delivery_attempt, 2);
  });

  test("answers 400 to an invalid request, so it ends up in the DLQ", async () => {
    const handle = createWorker({ takeSnapshot: async () => { throw new InvalidRequestError("invalid snapshot_id"); } });
    const { result, entries } = await captureLogs(() => handle(push(event)));
    assert.equal(result.statusCode, 400);
    assert.equal(entries.find((e) => e.message === "invalid snapshot request").severity, "WARNING");
  });

  test("answers 400 to a malformed push message", async () => {
    const handle = createWorker({ takeSnapshot: async () => { throw new Error("must not be called"); } });
    const { result } = await captureLogs(() => handle(Buffer.from("not json")));
    assert.equal(result.statusCode, 400);
  });

  test("never writes the interaction token to the logs", async () => {
    const handle = createWorker({ takeSnapshot: async () => { throw new Error("boom"); } });
    const { lines } = await captureLogs(() => handle(push(event)));
    assert.ok(!lines.join("\n").includes("secret-token"));
  });
});
