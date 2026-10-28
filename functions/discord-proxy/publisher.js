const { PubSub } = require("@google-cloud/pubsub");

let topic;

function getTopic() {
  if (!topic) {
    const name = process.env.PUBSUB_TOPIC;
    if (!name) throw new Error("PUBSUB_TOPIC is not configured");
    topic = new PubSub().topic(name);
  }
  return topic;
}

async function publishCommand(event) {
  return getTopic().publishMessage({
    json: event,
    attributes: {
      type: event.type,
      correlation_id: event.correlation_id
    }
  });
}

module.exports = { publishCommand };
