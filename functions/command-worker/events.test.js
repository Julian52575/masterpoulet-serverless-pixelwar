const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPixelEvents, PIXEL_PROCESSED } = require("./events");

function fakeTopic() {
  const sent = [];
  return {
    sent,
    publishMessage: async (message) => {
      sent.push(message);
      return `msg-${sent.length}`;
    }
  };
}

const pixel = {
  x: 300,
  y: 20,
  color: "#e50000",
  author: "111",
  authorName: "Alice",
  updatedAt: new Date("2026-10-29T10:00:14.000Z"),
  correlationId: "corr-1"
};

describe("pixel.processed", () => {
  test("publishes the changed pixel as JSON", async () => {
    const topic = fakeTopic();
    await createPixelEvents({ topic }).pixelProcessed(pixel);

    assert.deepEqual(topic.sent[0].json, {
      type: "pixel.processed",
      x: 300,
      y: 20,
      tile: "1_0",
      color: "#e50000",
      author: "111",
      author_name: "Alice",
      updated_at: "2026-10-29T10:00:14.000Z",
      correlation_id: "corr-1"
    });
  });

  test("adds the type, the tile and the correlation id as filterable attributes", async () => {
    const topic = fakeTopic();
    await createPixelEvents({ topic }).pixelProcessed(pixel);
    assert.deepEqual(topic.sent[0].attributes, { type: PIXEL_PROCESSED, tile: "1_0", correlation_id: "corr-1" });
  });

  test("returns the Pub/Sub message id", async () => {
    const topic = fakeTopic();
    assert.equal(await createPixelEvents({ topic }).pixelProcessed(pixel), "msg-1");
  });

  test("keeps attributes as strings when optional values are missing", async () => {
    const topic = fakeTopic();
    await createPixelEvents({ topic }).pixelProcessed({ ...pixel, authorName: undefined, correlationId: undefined });
    assert.equal(topic.sent[0].json.author_name, null);
    assert.equal(topic.sent[0].json.correlation_id, null);
    assert.equal(topic.sent[0].attributes.correlation_id, "");
  });

  test("lets a Pub/Sub failure reach the caller", async () => {
    const topic = { publishMessage: async () => { throw new Error("pubsub unavailable"); } };
    await assert.rejects(createPixelEvents({ topic }).pixelProcessed(pixel), /pubsub unavailable/);
  });
});
