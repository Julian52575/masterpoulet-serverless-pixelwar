const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotRequests, SNAPSHOT_REQUESTED } = require("./snapshots");

function fakeTopic() {
  const sent = [];
  return { sent, publishMessage: async (message) => { sent.push(message); return `msg-${sent.length}`; } };
}

const request = {
  snapshotId: "1300000000000000000",
  requestedAt: new Date("2026-10-29T12:00:00.000Z"),
  requestedBy: "999",
  applicationId: "123456789012345678",
  interactionToken: "secret-token",
  channelId: "555",
  correlationId: "corr-7"
};

describe("snapshot.requested", () => {
  test("publishes everything the snapshot worker needs, including how to answer Discord", async () => {
    const topic = fakeTopic();
    await createSnapshotRequests({ topic }).request(request);

    assert.deepEqual(topic.sent[0].json, {
      type: "snapshot.requested",
      snapshot_id: "1300000000000000000",
      requested_at: "2026-10-29T12:00:00.000Z",
      requested_by: "999",
      application_id: "123456789012345678",
      interaction_token: "secret-token",
      channel_id: "555",
      correlation_id: "corr-7"
    });
  });

  test("keeps the token out of the attributes, which are easier to see in the console", async () => {
    const topic = fakeTopic();
    await createSnapshotRequests({ topic }).request(request);
    assert.deepEqual(topic.sent[0].attributes, {
      type: SNAPSHOT_REQUESTED,
      snapshot_id: "1300000000000000000",
      correlation_id: "corr-7"
    });
  });

  test("returns the Pub/Sub message id", async () => {
    assert.equal(await createSnapshotRequests({ topic: fakeTopic() }).request(request), "msg-1");
  });

  test("stores missing optional values as null in the message and empty text in the attributes", async () => {
    const topic = fakeTopic();
    await createSnapshotRequests({ topic }).request({ ...request, channelId: undefined, correlationId: undefined });
    assert.equal(topic.sent[0].json.channel_id, null);
    assert.equal(topic.sent[0].json.correlation_id, null);
    assert.equal(topic.sent[0].attributes.correlation_id, "");
  });
});
