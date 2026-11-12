const { PubSub } = require("@google-cloud/pubsub");
const { readTopic, TOPICS } = require("./config");
const { routeCommand } = require("./routing");

let client;
const defaultTopic = (name) => (client ??= new PubSub()).topic(name);

function createPublisher({ createTopic = defaultTopic, env = process.env, now = () => new Date() } = {}) {
  const topics = new Map();

  function getTopic(route) {
    const name = readTopic(route, env);
    if (!name) throw new Error(`${TOPICS[route]} is not configured`);
    if (!topics.has(name)) topics.set(name, createTopic(name));
    return topics.get(name);
  }

  return async function publishCommand(command) {
    const { route, event, attributes } = routeCommand(command, now());
    return getTopic(route).publishMessage({ json: event, attributes });
  };
}

const publishCommand = createPublisher();

module.exports = { createPublisher, publishCommand };
