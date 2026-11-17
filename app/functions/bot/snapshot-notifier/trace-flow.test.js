const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { SpanKind, SpanStatusCode } = require("@opentelemetry/api");
const { startTracing, flushTraces } = require("./tracing");
const { createNotifier } = require("./notifier");
const { OBJECT_FINALIZED } = require("./cloudevent");

const exporter = new InMemorySpanExporter();
startTracing({ service: "snapshot-notifier", env: {}, exporter });

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const WORKER_SPAN = "00f067aa0ba902b7";
const NAME = "snapshots/2026-11-13T12-00-00-000Z_42.png";
const metadata = {
  snapshot_id: "42",
  requested_at: "2026-11-13T12:00:00.000Z",
  requested_by: "999",
  pixel_count: "3",
  application_id: "123456789012345678",
  interaction_token: "secret-token",
  correlation_id: "corr-snap",
  traceparent: `00-${TRACE_ID}-${WORKER_SPAN}-01`
};

function make({ meta = metadata, discordError } = {}) {
  const files = { metadataOf: async () => meta, signedUrl: async () => "https://signed.example/x.png" };
  const discord = {
    editOriginal: async () => {
      if (discordError) throw discordError;
    }
  };
  return createNotifier({ files, discord, bucket: "snaps", ttlMinutes: 60 });
}

async function run(handle) {
  const out = mock.method(console, "log", () => {});
  const err = mock.method(console, "error", () => {});
  try {
    const result = await handle({ "ce-id": "evt-1", "ce-type": OBJECT_FINALIZED }, Buffer.from(JSON.stringify({ bucket: "snaps", name: NAME })));
    await flushTraces();
    const entries = [...out.mock.calls, ...err.mock.calls].map((call) => JSON.parse(call.arguments[0]));
    return { result, entries, spans: exporter.getFinishedSpans() };
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
}

describe("tracing through the bucket", () => {
  beforeEach(() => exporter.reset());

  test("continues the trace saved by the snapshot worker in the object metadata", async () => {
    const { result, entries, spans } = await run(make());
    assert.equal(result.statusCode, 204);

    const [span] = spans;
    assert.equal(span.name, "snapshot-notifier deliver");
    assert.equal(span.kind, SpanKind.CONSUMER);
    assert.equal(span.spanContext().traceId, TRACE_ID);
    assert.equal(span.parentSpanContext.spanId, WORKER_SPAN);
    assert.equal(span.attributes.correlation_id, "corr-snap");
    assert.ok(!JSON.stringify(span.attributes).includes("secret-token"));

    const sent = entries.find((entry) => entry.message === "snapshot link sent");
    assert.equal(sent.trace_id, TRACE_ID);
  });

  test("starts a new trace for an older snapshot without trace context", async () => {
    const { traceparent, ...older } = metadata;
    const { spans } = await run(make({ meta: older }));
    assert.equal(spans[0].parentSpanContext, undefined);
  });

  test("marks a Discord outage as an error", async () => {
    const outage = Object.assign(new Error("discord down"), { status: 503, retryable: true });
    const { result, spans } = await run(make({ discordError: outage }));
    assert.equal(result.statusCode, 500);
    assert.equal(spans[0].status.code, SpanStatusCode.ERROR);
  });
});
