const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { SpanKind, SpanStatusCode } = require("@opentelemetry/api");
const { startTracing, flushTraces, traceContext } = require("./tracing");
const { createWorker } = require("./worker");

const exporter = new InMemorySpanExporter();
startTracing({ service: "snapshot-worker", env: {}, exporter });

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_ID = "00f067aa0ba902b7";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const push = (event, attributes) =>
  Buffer.from(JSON.stringify({ message: { data: encode(event), messageId: "m-1", attributes }, deliveryAttempt: 1 }));
const request = { type: "snapshot.requested", snapshot_id: "42", requested_by: "999", correlation_id: "corr-7" };

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

describe("tracing through Pub/Sub and the bucket", () => {
  beforeEach(() => exporter.reset());

  test("continues the trace of the proxy and hands it on to the snapshot metadata", async () => {
    let carried;
    const handle = createWorker({
      takeSnapshot: async () => {
        carried = traceContext();
        return { skipped: false, snapshotId: "42", name: "snapshots/42.png" };
      }
    });
    const { result, entries, spans } = await run(handle, push(request, { traceparent: `00-${TRACE_ID}-${PARENT_ID}-01` }));

    assert.equal(result.statusCode, 204);
    const [span] = spans;
    assert.equal(span.name, "snapshot-worker take snapshot");
    assert.equal(span.kind, SpanKind.CONSUMER);
    assert.equal(span.spanContext().traceId, TRACE_ID);
    assert.equal(span.parentSpanContext.spanId, PARENT_ID);
    assert.equal(carried.traceparent, `00-${TRACE_ID}-${span.spanContext().spanId}-01`);
    for (const entry of entries) assert.equal(entry.trace_id, TRACE_ID);
  });

  test("a scheduled snapshot starts its own trace", async () => {
    const handle = createWorker({ takeSnapshot: async () => ({ skipped: true, snapshotId: "scheduled-1" }) });
    const { spans } = await run(handle, push({ type: "snapshot.scheduled" }));
    assert.equal(spans.length, 1);
    assert.equal(spans[0].parentSpanContext, undefined);
    assert.equal(spans[0].attributes.event_type, "snapshot.scheduled");
  });

  test("marks a failed snapshot as an error", async () => {
    const handle = createWorker({ takeSnapshot: async () => { throw new Error("bucket down"); } });
    const { result, spans } = await run(handle, push(request));
    assert.equal(result.statusCode, 500);
    assert.equal(spans[0].status.code, SpanStatusCode.ERROR);
  });
});
