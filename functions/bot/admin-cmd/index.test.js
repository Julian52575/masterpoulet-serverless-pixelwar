const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.ADMIN_USER_IDS = "999";
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("adminCmd");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("answers 400 to a command that is not an admin command", async () => {
    const body = JSON.stringify({ message: { data: encode({ type: "draw", user_id: "999", correlation_id: "c" }) } });
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
  test("refuses to load when an admin id is not a Discord id", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH, ADMIN_USER_IDS: "alice" }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /ADMIN_USER_IDS contains invalid Discord ids: alice/);
  });
});
