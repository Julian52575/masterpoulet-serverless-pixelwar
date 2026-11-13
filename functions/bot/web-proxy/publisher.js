const { PubSub } = require("@google-cloud/pubsub");
const { readDrawTopic } = require("./config");

let client;
const defaultTopic = (name) => (client ??= new PubSub()).topic(name);

function createPublisher({ createTopic = defaultTopic, env = process.env } = {}) {
  let topic;

  return async function publishDraw(event) {
    const name = readDrawTopic(env);
    if (!name) throw new Error("DRAW_TOPIC is not configured");
    topic ??= createTopic(name);
    return topic.publishMessage({
      json: event,
      attributes: { type: event.type, source: event.source, correlation_id: event.correlation_id }
    });
  };
}

module.exports = { createPublisher };
