const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseStorageEvent, InvalidEventError, OBJECT_FINALIZED } = require("./cloudevent");

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
      id: "evt-1",
      type: OBJECT_FINALIZED,
      finalized: true,
      bucket: "snaps",
      name: "snapshots/a.png"
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
    "a request without ce-type": [{}, body],
    "a body that is not JSON": [headers, "not json"],
    "a body without object name": [headers, JSON.stringify({ bucket: "snaps" })],
    "a body without bucket": [headers, JSON.stringify({ name: "snapshots/a.png" })]
  })) {
    test(`rejects ${name}`, () => {
      assert.throws(() => parseStorageEvent(h, b), InvalidEventError);
    });
  }
});
