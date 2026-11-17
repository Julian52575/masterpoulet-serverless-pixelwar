const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { InMemorySpanExporter } = require("@opentelemetry/sdk-trace-base");
const { createPublisher } = require("./publisher");
const { startTracing, flushTraces, inSpan, SpanKind } = require("./tracing");

const ENV = { DRAW_TOPIC: "draw-pixel", COMMANDS_TOPIC: "commands", SNAPSHOT_TOPIC: "snapshot" };
const NOW = new Date("2026-11-12T10:00:00.000Z");
const base = { user_id: "111", interaction_id: "42", interaction_token: "token-1", correlation_id: "abc" };

describe("createPublisher", () => {
  let sent;
  let created;

  const createTopic = (name) => {
    created.push(name);
    return { publishMessage: async (message) => { sent.push({ topic: name, ...message }); return `msg-${sent.length}`; } };
  };
  const publisher = (env = ENV) => createPublisher({ createTopic, env, now: () => NOW });

  beforeEach(() => {
    sent = [];
    created = [];
  });

  test("publishes /draw on the draw topic and returns the message id", async () => {
    const event = { ...base, type: "draw", payload: { x: 1, y: 2, color: "red" } };
    assert.equal(await publisher()(event), "msg-1");
    assert.deepEqual(sent, [{ topic: "draw-pixel", json: event, attributes: { type: "draw", correlation_id: "abc" } }]);
  });

  test("publishes /get and admin commands on the commands topic", async () => {
    const publish = publisher();
    await publish({ ...base, type: "get", payload: {} });
    await publish({ ...base, type: "admin.clear", payload: {} });
    assert.deepEqual(sent.map((m) => [m.topic, m.attributes.type]), [["commands", "get"], ["commands", "admin.clear"]]);
  });

  test("publishes /snapshot as a snapshot request on the snapshot topic", async () => {
    await publisher()({ ...base, type: "snapshot", payload: {} });
    assert.equal(sent[0].topic, "snapshot");
    assert.equal(sent[0].json.type, "snapshot.requested");
    assert.equal(sent[0].json.snapshot_id, "42");
    assert.equal(sent[0].json.requested_at, NOW.toISOString());
  });

  test("creates each topic client only once", async () => {
    const publish = publisher();
    await publish({ ...base, type: "get" });
    await publish({ ...base, type: "admin.pause" });
    await publish({ ...base, type: "draw" });
    assert.deepEqual(created, ["commands", "draw-pixel"]);
  });

  test("trims the topic names", async () => {
    await publisher({ ...ENV, DRAW_TOPIC: " draw-pixel\n" })({ ...base, type: "draw" });
    assert.equal(sent[0].topic, "draw-pixel");
  });

  for (const [type, variable] of [["draw", "DRAW_TOPIC"], ["get", "COMMANDS_TOPIC"], ["snapshot", "SNAPSHOT_TOPIC"]]) {
    test(`fails clearly when ${variable} is not configured`, async () => {
      const publish = publisher({ ...ENV, [variable]: "" });
      await assert.rejects(publish({ ...base, type }), new RegExp(`${variable} is not configured`));
      assert.equal(sent.length, 0);
    });
  }
});

describe("tracing", () => {
  test("records a producer span under the interaction and passes its trace context to the worker", async () => {
    const exporter = new InMemorySpanExporter();
    startTracing({ service: "discord-proxy", env: {}, exporter });
    const sent = [];
    const publish = createPublisher({
      env: ENV,
      now: () => NOW,
      createTopic: () => ({ publishMessage: async (message) => { sent.push(message); return "msg-7"; } })
    });

    await inSpan("discord-proxy interaction", { kind: SpanKind.SERVER }, () => publish({ ...base, type: "admin.pause", payload: {} }));
    await flushTraces();

    const spans = exporter.getFinishedSpans();
    const producer = spans.find((span) => span.name === "publish commands");
    const server = spans.find((span) => span.name === "discord-proxy interaction");
    assert.equal(producer.kind, SpanKind.PRODUCER);
    assert.equal(producer.parentSpanContext.spanId, server.spanContext().spanId);
    assert.equal(producer.attributes.type, "admin.pause");
    assert.equal(producer.attributes["messaging.message.id"], "msg-7");
    const { traceId, spanId } = producer.spanContext();
    assert.deepEqual(sent[0].attributes, { type: "admin.pause", correlation_id: "abc", traceparent: `00-${traceId}-${spanId}-01` });
  });
});
