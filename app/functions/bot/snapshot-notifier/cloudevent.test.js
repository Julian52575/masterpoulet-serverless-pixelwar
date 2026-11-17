const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseStorageEvent, InvalidEventError, OBJECT_FINALIZED, OBJECT_FINALIZE } = require("./cloudevent");

const headers = {
  "ce-id": "evt-1",
  "ce-type": OBJECT_FINALIZED,
  "ce-source": "//storage.googleapis.com/projects/_/buckets/snaps",
  "ce-subject": "objects/snapshots/a.png"
};
const body = JSON.stringify({ bucket: "snaps", name: "snapshots/a.png", contentType: "image/png" });

describe("parseStorageEvent", () => {
  test("reads an Eventarc object.finalized event sent in CloudEvent binary mode", () => {
    assert.deepEqual(parseStorageEvent(headers, Buffer.from(body)), {
      source: "eventarc",
      id: "evt-1",
      type: OBJECT_FINALIZED,
      finalized: true,
      bucket: "snaps",
      name: "snapshots/a.png",
      deliveryAttempt: null
    });
  });

  test("recognises other storage events as not finalized", () => {
    const event = parseStorageEvent({ ...headers, "ce-type": "google.cloud.storage.object.v1.deleted" }, body);
    assert.equal(event.finalized, false);
  });

  test("accepts header values given as arrays", () => {
    assert.equal(parseStorageEvent({ "ce-type": [OBJECT_FINALIZED] }, body).finalized, true);
  });

  for (const [name, [h, b]] of Object.entries({
    "a body that is not JSON": [headers, "not json"],
    "a body without object name": [headers, JSON.stringify({ bucket: "snaps" })],
    "a body without bucket": [headers, JSON.stringify({ name: "snapshots/a.png" })]
  })) {
    test(`rejects ${name}`, () => {
      assert.throws(() => parseStorageEvent(h, b), InvalidEventError);
    });
  }
});

const notification = (attributes, extra = {}) => JSON.stringify({
  message: {
    attributes: {
      notificationConfig: "projects/_/buckets/snaps/notificationConfigs/1",
      eventType: OBJECT_FINALIZE,
      payloadFormat: "JSON_API_V1",
      bucketId: "snaps",
      objectId: "snapshots/a.png",
      objectGeneration: "1700000000000000",
      ...attributes
    },
    data: Buffer.from(JSON.stringify({ bucket: "snaps", name: "snapshots/a.png" })).toString("base64"),
    messageId: "msg-9",
    publishTime: "2026-11-13T12:00:00.000Z"
  },
  subscription: "projects/demo/subscriptions/snapshot-created",
  deliveryAttempt: 3,
  ...extra
});

describe("parseStorageEvent with a Cloud Storage Pub/Sub notification", () => {
  test("reads the bucket, object and event type from the message attributes", () => {
    assert.deepEqual(parseStorageEvent({ "content-type": "application/json" }, Buffer.from(notification({}))), {
      source: "pubsub",
      id: "msg-9",
      type: OBJECT_FINALIZE,
      finalized: true,
      bucket: "snaps",
      name: "snapshots/a.png",
      deliveryAttempt: 3
    });
  });

  test("does not need the object payload (payload format NONE)", () => {
    const body = JSON.parse(notification({ payloadFormat: "NONE" }));
    body.message.data = "";
    assert.equal(parseStorageEvent({}, JSON.stringify(body)).finalized, true);
  });

  for (const type of ["OBJECT_DELETE", "OBJECT_METADATA_UPDATE", "OBJECT_ARCHIVE"]) {
    test(`recognises ${type} as not finalized`, () => {
      assert.equal(parseStorageEvent({}, notification({ eventType: type })).finalized, false);
    });
  }

  for (const [name, body] of Object.entries({
    "a body that is not a push message": JSON.stringify({ hello: "world" }),
    "a message without eventType": notification({ eventType: undefined }),
    "a message without objectId": notification({ objectId: undefined }),
    "a message without bucketId": notification({ bucketId: undefined }),
    "an empty body": ""
  })) {
    test(`rejects ${name}`, () => {
      assert.throws(() => parseStorageEvent({}, body), InvalidEventError);
    });
  }
});
