const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { correlationIdFrom, CORRELATION_ID } = require("./correlation");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("correlationIdFrom", () => {
  test("keeps the id sent by the browser", () => {
    assert.equal(correlationIdFrom({ "x-correlation-id": "web-3f9c2a7b1d" }), "web-3f9c2a7b1d");
  });

  test("creates a new id when none is sent", () => {
    assert.match(correlationIdFrom({}), UUID);
    assert.match(correlationIdFrom(), UUID);
    assert.notEqual(correlationIdFrom({}), correlationIdFrom({}));
  });

  test("replaces an id that could break the logs or the Pub/Sub attributes", () => {
    for (const bad of ["short", "x".repeat(65), "has space in it", "line\nbreak-123", "quote\"inside", "<script>1234", ["array-123456"]]) {
      const id = correlationIdFrom({ "x-correlation-id": bad });
      assert.match(id, UUID, String(bad));
      assert.match(id, CORRELATION_ID);
    }
  });

  test("a generated id is itself a valid id", () => {
    assert.match(correlationIdFrom({}), CORRELATION_ID);
  });
});
