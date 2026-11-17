const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { SpanKind, SpanStatusCode } = require("@opentelemetry/api");
const { startTracing, flushTraces } = require("./tracing");
const { createWorker } = require("./worker");

const exporter = new InMemorySpanExporter();
startTracing({ service: "admin-cmd", env: {}, exporter });

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_ID = "00f067aa0ba902b7";
const authorizer = { isAdmin: () => true };
const discord = { editOriginal: async () => {} };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const push = (event, attributes) =>
  Buffer.from(JSON.stringify({ message: { data: encode(event), messageId: "msg-1", attributes }, deliveryAttempt: 1 }));
const draw = { type: "admin.pause", user_id: "111", interaction_id: "interaction-1", correlation_id: "corr-1" };

async function run(handle, body) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await handle(body);
    await flushTraces();
    const entries = [...out.mock.calls, ...err.mock.calls].map((call) => JSON.parse(call.arguments[0]));
    return { result, entries, spans: exporter.getFinishedSpans() };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
}

describe("tracing through Pub/Sub", () => {
  beforeEach(() => exporter.reset());

  test("continues the trace of the publisher and logs its trace id", async () => {
    const handle = createWorker({ handlers: { "admin.pause": async () => {} }, authorizer, discord });
    const { result, entries, spans } = await run(handle, push(draw, { traceparent: `00-${TRACE_ID}-${PARENT_ID}-01` }));

    assert.equal(result.statusCode, 204);
    const [span] = spans;
    assert.equal(span.name, "admin-cmd admin.pause");
    assert.equal(span.kind, SpanKind.CONSUMER);
    assert.equal(span.spanContext().traceId, TRACE_ID);
    assert.equal(span.parentSpanContext.spanId, PARENT_ID);
    assert.equal(span.attributes.correlation_id, "corr-1");
    assert.equal(span.attributes["http.response.status_code"], 204);
    for (const entry of entries) {
      assert.equal(entry.trace_id, TRACE_ID);
      assert.equal(entry.span_id, span.spanContext().spanId);
    }
  });

  test("starts a new trace when the message has no trace context", async () => {
    const handle = createWorker({ handlers: { "admin.pause": async () => {} }, authorizer, discord });
    const { spans } = await run(handle, push(draw));
    assert.equal(spans.length, 1);
    assert.notEqual(spans[0].spanContext().traceId, TRACE_ID);
    assert.equal(spans[0].parentSpanContext, undefined);
  });

  test("marks a failed command as an error so Pub/Sub retries show in the trace", async () => {
    const handle = createWorker({ handlers: { "admin.pause": async () => { throw new Error("firestore down"); } }, authorizer, discord });
    const { result, spans } = await run(handle, push(draw));
    assert.equal(result.statusCode, 500);
    assert.equal(spans[0].status.code, SpanStatusCode.ERROR);
  });

  test("does not use an unknown command type as the span name", async () => {
    const handle = createWorker({ handlers: { "admin.pause": async () => {} }, authorizer, discord });
    const { spans } = await run(handle, push({ ...draw, type: "x".repeat(300) }));
    assert.equal(spans[0].name, "admin-cmd unknown");
  });
});
