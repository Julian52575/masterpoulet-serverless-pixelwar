const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { SpanStatusCode } = require("@opentelemetry/api");
const {
  startTracing,
  flushTraces,
  inSpan,
  recordStatus,
  annotate,
  traceContext,
  traceFields,
  tracingEnabled,
  sampleRatio,
  SpanKind
} = require("./tracing");
const { log } = require("./logger");

const exporter = new InMemorySpanExporter();
const provider = startTracing({ service: "draw-pixel", env: {}, exporter });

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/;

async function finished() {
  await flushTraces();
  return exporter.getFinishedSpans();
}

function captureLog(fn) {
  const spy = mock.method(console, "log", () => {});
  try {
    fn();
    return JSON.parse(spy.mock.calls[0].arguments[0]);
  } finally {
    spy.mock.restore();
  }
}

describe("tracing settings", () => {
  test("is on by default in the cloud and off locally", () => {
    assert.equal(tracingEnabled({ K_SERVICE: "draw-pixel" }), true);
    assert.equal(tracingEnabled({}), false);
  });

  test("TRACING_ENABLED forces it either way", () => {
    assert.equal(tracingEnabled({ K_SERVICE: "draw-pixel", TRACING_ENABLED: "false" }), false);
    assert.equal(tracingEnabled({ TRACING_ENABLED: "true" }), true);
  });

  test("the sample ratio defaults to 1 and ignores invalid values", () => {
    assert.equal(sampleRatio(undefined), 1);
    assert.equal(sampleRatio(""), 1);
    assert.equal(sampleRatio("0.25"), 0.25);
    assert.equal(sampleRatio("0"), 0);
    for (const bad of ["-1", "2", "abc"]) assert.equal(sampleRatio(bad), 1, bad);
  });

  test("starting twice keeps the first provider", () => {
    assert.equal(startTracing({ service: "other", env: {} }), provider);
  });
});

describe("spans", () => {
  beforeEach(() => exporter.reset());

  test("records a span with its kind, its attributes and the service name", async () => {
    const result = await inSpan("draw-pixel draw", { kind: SpanKind.CONSUMER, attributes: { correlation_id: "abc", empty: "", missing: null, attempt: 2 } }, async () => "done");
    assert.equal(result, "done");

    const [span] = await finished();
    assert.equal(span.name, "draw-pixel draw");
    assert.equal(span.kind, SpanKind.CONSUMER);
    assert.deepEqual(span.attributes, { correlation_id: "abc", attempt: 2 });
    assert.equal(span.resource.attributes["service.name"], "draw-pixel");
  });

  test("nests a span under the active one", async () => {
    await inSpan("outer", {}, () => inSpan("inner", {}, async () => {}));
    const spans = await finished();
    const outer = spans.find((s) => s.name === "outer");
    const inner = spans.find((s) => s.name === "inner");
    assert.equal(inner.spanContext().traceId, outer.spanContext().traceId);
    assert.equal(inner.parentSpanContext.spanId, outer.spanContext().spanId);
  });

  test("continues the trace found in a traceparent carrier", async () => {
    const carrier = await inSpan("publish", { kind: SpanKind.PRODUCER }, async () => traceContext());
    assert.match(carrier.traceparent, TRACEPARENT);
    const [, traceId, parentId] = carrier.traceparent.match(TRACEPARENT);

    await inSpan("consume", { kind: SpanKind.CONSUMER, parent: carrier }, async () => {});
    const consume = (await finished()).find((s) => s.name === "consume");
    assert.equal(consume.spanContext().traceId, traceId);
    assert.equal(consume.parentSpanContext.spanId, parentId);
  });

  test("a parent carrier wins over the active span", async () => {
    let outerTrace;
    await inSpan("outer", {}, async (span) => {
      outerTrace = span.spanContext().traceId;
      await inSpan("from message", { parent: {} }, async () => {});
    });
    const fresh = (await finished()).find((s) => s.name === "from message");
    assert.notEqual(fresh.spanContext().traceId, outerTrace);
    assert.equal(fresh.parentSpanContext, undefined);
  });

  test("records a thrown error and rethrows it", async () => {
    await assert.rejects(inSpan("fails", {}, async () => { throw new Error("boom"); }), /boom/);
    const [span] = await finished();
    assert.equal(span.status.code, SpanStatusCode.ERROR);
    assert.equal(span.events[0].name, "exception");
  });

  test("recordStatus marks 5xx answers as errors only", async () => {
    await inSpan("ok", {}, async (span) => recordStatus(span, 400));
    await inSpan("ko", {}, async (span) => recordStatus(span, 500));
    const spans = await finished();
    const ok = spans.find((s) => s.name === "ok");
    const ko = spans.find((s) => s.name === "ko");
    assert.equal(ok.attributes["http.response.status_code"], 400);
    assert.equal(ok.status.code, SpanStatusCode.UNSET);
    assert.equal(ko.status.code, SpanStatusCode.ERROR);
  });

  test("annotate adds attributes to the active span and does nothing outside one", async () => {
    annotate({ correlation_id: "outside" });
    await inSpan("annotated", {}, async () => annotate({ correlation_id: "abc", user_id: undefined }));
    const [span] = await finished();
    assert.deepEqual(span.attributes, { correlation_id: "abc" });
  });

  test("traceContext is empty outside a span", () => {
    assert.deepEqual(traceContext(), {});
  });
});

describe("trace fields in the logs", () => {
  test("are empty outside a span", () => {
    assert.deepEqual(traceFields({}), {});
    const entry = captureLog(() => log.info("outside"));
    assert.equal(entry.trace_id, undefined);
  });

  test("give the trace and span ids inside a span", async () => {
    await inSpan("logged", {}, async (span) => {
      const { traceId, spanId } = span.spanContext();
      assert.deepEqual(traceFields({}), { trace_id: traceId, span_id: spanId });

      const entry = captureLog(() => log.info("inside", { correlation_id: "abc" }));
      assert.equal(entry.trace_id, traceId);
      assert.equal(entry.span_id, spanId);
      assert.equal(entry.correlation_id, "abc");
    });
  });

  test("add the Cloud Logging trace fields when the project is known", async () => {
    await inSpan("logged", {}, async (span) => {
      const { traceId, spanId } = span.spanContext();
      const fields = traceFields({ GOOGLE_CLOUD_PROJECT: "pixelwar-dev" });
      assert.equal(fields["logging.googleapis.com/trace"], `projects/pixelwar-dev/traces/${traceId}`);
      assert.equal(fields["logging.googleapis.com/spanId"], spanId);
      assert.equal(fields["logging.googleapis.com/trace_sampled"], true);
    });
  });
});
