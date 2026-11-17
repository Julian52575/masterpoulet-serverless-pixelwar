const { PubSub } = require("@google-cloud/pubsub");
const { readDrawTopic } = require("./config");
const { inSpan, traceContext, SpanKind } = require("./tracing");

let client;
const defaultTopic = (name) => (client ??= new PubSub()).topic(name);

function createPublisher({ createTopic = defaultTopic, env = process.env } = {}) {
  let topic;

  return async function publishDraw(event) {
    const name = readDrawTopic(env);
    if (!name) throw new Error("DRAW_TOPIC is not configured");
    topic ??= createTopic(name);
    const span = { kind: SpanKind.PRODUCER, attributes: { "messaging.system": "gcp_pubsub", "messaging.destination.name": name } };
    return inSpan(`publish ${name}`, span, async (producer) => {
      const messageId = await topic.publishMessage({
        json: event,
        attributes: { type: event.type, source: event.source, correlation_id: event.correlation_id, ...traceContext() }
      });
      producer.setAttribute("messaging.message.id", String(messageId));
      return messageId;
    });
  };
}

module.exports = { createPublisher };
