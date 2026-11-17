const { PubSub } = require("@google-cloud/pubsub");
const { readTopic, TOPICS } = require("./config");
const { routeCommand } = require("./routing");
const { inSpan, traceContext, SpanKind } = require("./tracing");

let client;
const defaultTopic = (name) => (client ??= new PubSub()).topic(name);

function createPublisher({ createTopic = defaultTopic, env = process.env, now = () => new Date() } = {}) {
  const topics = new Map();

  function getTopic(route) {
    const name = readTopic(route, env);
    if (!name) throw new Error(`${TOPICS[route]} is not configured`);
    if (!topics.has(name)) topics.set(name, createTopic(name));
    return { name, topic: topics.get(name) };
  }

  return async function publishCommand(command) {
    const { route, event, attributes } = routeCommand(command, now());
    const { name, topic } = getTopic(route);
    const span = { kind: SpanKind.PRODUCER, attributes: { "messaging.system": "gcp_pubsub", "messaging.destination.name": name, type: event.type } };
    return inSpan(`publish ${name}`, span, async (producer) => {
      const messageId = await topic.publishMessage({ json: event, attributes: { ...attributes, ...traceContext() } });
      producer.setAttribute("messaging.message.id", String(messageId));
      return messageId;
    });
  };
}

const publishCommand = createPublisher();

module.exports = { createPublisher, publishCommand };
