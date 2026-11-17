const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { createPublisher } = require("./publisher");
const { startTracing, flushTraces, inSpan, SpanKind } = require("./tracing");

const event = { type: "web.draw", source: "web", user_id: "1", correlation_id: "c-1", rect: { x0: 0, y0: 0, x1: 1, y1: 1 } };

describe("createPublisher", () => {
  test("publishes on DRAW_TOPIC with filterable attributes", async () => {
    const sent = [];
    const created = [];
    const publish = createPublisher({
      env: { DRAW_TOPIC: " draw-pixel " },
      createTopic: (name) => {
        created.push(name);
        return { publishMessage: async (message) => { sent.push(message); return "msg-1"; } };
      }
    });

    assert.equal(await publish(event), "msg-1");
    await publish(event);

    assert.deepEqual(created, ["draw-pixel"]);
    assert.deepEqual(sent[0], { json: event, attributes: { type: "web.draw", source: "web", correlation_id: "c-1" } });
  });

  test("records a producer span and passes its trace context in the attributes", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({ service: "web-proxy", env: {}, exporter });
    const sent = [];
    const publish = createPublisher({
      env: { DRAW_TOPIC: "draw-pixel" },
      createTopic: () => ({ publishMessage: async (message) => { sent.push(message); return "msg-9"; } })
    });

    await inSpan("POST /pixels", { kind: SpanKind.SERVER }, () => publish(event));
    await flushTraces();

    const spans = exporter.getFinishedSpans();
    const producer = spans.find((span) => span.name === "publish draw-pixel");
    const server = spans.find((span) => span.name === "POST /pixels");
    assert.equal(producer.kind, SpanKind.PRODUCER);
    assert.equal(producer.parentSpanContext.spanId, server.spanContext().spanId);
    assert.equal(producer.attributes["messaging.message.id"], "msg-9");
    const { traceId, spanId } = producer.spanContext();
    assert.equal(sent[0].attributes.traceparent, `00-${traceId}-${spanId}-01`);
    assert.equal(sent[0].attributes.correlation_id, "c-1");
  });

  test("fails clearly when DRAW_TOPIC is not configured", async () => {
    const publish = createPublisher({ env: {}, createTopic: () => assert.fail("no topic expected") });
    await assert.rejects(publish(event), /DRAW_TOPIC is not configured/);
  });
});
