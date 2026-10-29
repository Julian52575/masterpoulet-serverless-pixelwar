const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, SNAPSHOT_PENDING } = require("./handlers");
const { snowflakeTime } = require("./snowflake");

const INTERACTION_ID = "1300000000000000000";

function make({ snapshotsError } = {}) {
  const calls = [];
  const snapshots = {
    request: async (request) => {
      if (snapshotsError) throw snapshotsError;
      calls.push({ request });
    }
  };
  const discord = { editOriginal: async (event, message) => calls.push({ reply: message.content }) };
  const handlers = createHandlers({ snapshots, discord, now: () => Date.UTC(2026, 9, 29) });
  return { snapshot: handlers.snapshot, calls };
}

const snapshotEvent = (extra = {}) => ({
  type: "snapshot",
  payload: {},
  user_id: "999",
  interaction_id: INTERACTION_ID,
  application_id: "123456789012345678",
  interaction_token: "tok",
  channel_id: "555",
  correlation_id: "corr-7",
  ...extra
});

describe("snapshot handler", () => {
  test("hands the work to the snapshot worker, then tells the admin it is on its way", async () => {
    const { snapshot, calls } = make();
    await snapshot(snapshotEvent());

    assert.deepEqual(calls, [
      {
        request: {
          snapshotId: INTERACTION_ID,
          requestedAt: snowflakeTime(INTERACTION_ID),
          requestedBy: "999",
          applicationId: "123456789012345678",
          interactionToken: "tok",
          channelId: "555",
          correlationId: "corr-7"
        }
      },
      { reply: SNAPSHOT_PENDING }
    ]);
  });

  test("names the snapshot after the command, so a replay produces the same snapshot", async () => {
    const { snapshot, calls } = make();
    await snapshot(snapshotEvent());
    await snapshot(snapshotEvent());
    assert.equal(calls[0].request.snapshotId, calls[2].request.snapshotId);
    assert.deepEqual(calls[0].request.requestedAt, calls[2].request.requestedAt);
  });

  test("falls back to the correlation id and the current time without an interaction id", async () => {
    const { snapshot, calls } = make();
    await snapshot(snapshotEvent({ interaction_id: undefined }));
    assert.equal(calls[0].request.snapshotId, "corr-7");
    assert.deepEqual(calls[0].request.requestedAt, new Date(Date.UTC(2026, 9, 29)));
  });

  test("does not say it is on its way when the request could not be queued", async () => {
    const { snapshot, calls } = make({ snapshotsError: new Error("pubsub unavailable") });
    await assert.rejects(snapshot(snapshotEvent()), /pubsub unavailable/);
    assert.deepEqual(calls, []);
  });

  test("tells the admin that a link is coming", () => {
    assert.match(SNAPSHOT_PENDING, /lien/);
  });
});
