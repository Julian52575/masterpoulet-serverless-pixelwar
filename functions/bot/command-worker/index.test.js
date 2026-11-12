const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.PIXEL_EVENTS_TOPIC = "pixel-events";
    process.env.SNAPSHOT_TOPIC = "snapshot-requested";
    process.env.ADMIN_USER_IDS = "999";
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("commandWorker");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("answers 400 to a push message whose command type is unknown", async () => {
    const body = JSON.stringify({ message: { data: encode({ type: "unknown.command", correlation_id: "c" }) } });
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

describe("index.js startup", () => {
  test("refuses to load when the configuration is invalid", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH, PIXEL_EVENTS_TOPIC: "pixel-events", ADMIN_USER_IDS: "999" }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /SNAPSHOT_TOPIC is not configured/);
  });
});
