const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.DRAW_TOPIC = "draw-pixel";
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("webProxy");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  const post = (path, headers = {}) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ x: 1, y: 1, color: "red" })
  });

  test("answers 401 to a draw without a Discord token", async () => {
    const res = await post("/pixels");
    assert.equal(res.status, 401);
    assert.match(res.headers.get("x-correlation-id"), /^[0-9a-f-]{36}$/);
  });

  test("answers 404 to an unknown path", async () => {
    assert.equal((await post("/admin/clear")).status, 404);
  });

  test("answers 405 to a GET on a draw route", async () => {
    assert.equal((await fetch(`${baseUrl}/pixels`)).status, 405);
  });
});

describe("index.js startup", () => {
  test("refuses to load without DRAW_TOPIC", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /DRAW_TOPIC is not configured/);
  });
});
