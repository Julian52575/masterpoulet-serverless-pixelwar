const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("getCanvas");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("answers 400 to a command that is not /get", async () => {
    const body = JSON.stringify({ message: { data: encode({ type: "admin.clear", correlation_id: "c" }) } });
    const res = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(res.status, 400);
  });

  test("answers 400 to a malformed body", async () => {
    const res = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    assert.equal(res.status, 400);
  });

  test("answers 405 to other methods", async () => {
    assert.equal((await fetch(baseUrl)).status, 405);
  });
});
