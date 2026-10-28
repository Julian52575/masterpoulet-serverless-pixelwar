const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { PubSub } = require("@google-cloud/pubsub");
const { publishCommand } = require("./publisher");

describe("publishCommand", () => {
  test("fails clearly when PUBSUB_TOPIC is not configured", async () => {
    const saved = process.env.PUBSUB_TOPIC;
    delete process.env.PUBSUB_TOPIC;
    try {
      await assert.rejects(publishCommand({ type: "get" }), /PUBSUB_TOPIC is not configured/);
    } finally {
      if (saved !== undefined) process.env.PUBSUB_TOPIC = saved;
    }
  });

  test("publishes the event as JSON on the configured topic, with filterable attributes", async () => {
    const sent = [];
    const topicNames = [];
    const topicMock = mock.method(PubSub.prototype, "topic", (name) => {
      topicNames.push(name);
      return { publishMessage: async (message) => { sent.push(message); return "msg-42"; } };
    });
    process.env.PUBSUB_TOPIC = "discord-command";
    try {
      const event = { type: "draw", correlation_id: "abc", payload: { x: 1, y: 2, color: "red" } };
      const id = await publishCommand(event);
      await publishCommand(event);

      assert.equal(id, "msg-42");
      assert.deepEqual(topicNames, ["discord-command"]);
      assert.deepEqual(sent[0], {
        json: event,
        attributes: { type: "draw", correlation_id: "abc" }
      });
    } finally {
      topicMock.mock.restore();
      delete process.env.PUBSUB_TOPIC;
    }
  });
});
