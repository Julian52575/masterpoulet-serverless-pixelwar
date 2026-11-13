const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

describe("index.js", () => {
  let server;
  let baseUrl;

  before(async () => {
    Object.assign(process.env, {
      DISCORD_CLIENT_ID: "123456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      OAUTH_REDIRECT_URI: "https://pixelwar.example/api/auth/callback",
      APP_URL: "https://pixelwar.example/"
    });
    require("./index");
    const { getTestServer } = require("@google-cloud/functions-framework/testing");
    server = getTestServer("webAuth");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server?.close());

  test("redirects /api/auth/login to Discord with a state cookie", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.hostname, "discord.com");
    assert.equal(location.searchParams.get("scope"), "identify");
    assert.match(res.headers.get("set-cookie"), new RegExp(`__Host-pixelwar_oauth_state=${location.searchParams.get("state")};`));
  });

  test("sends a callback without state back to the app with an error", async () => {
    const res = await fetch(`${baseUrl}/api/auth/callback?code=abc`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://pixelwar.example/#auth_error=invalid_state");
  });
});

describe("index.js startup", () => {
  test("refuses to load with an invalid configuration", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./index')"], {
      cwd: __dirname,
      env: { PATH: process.env.PATH }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /DISCORD_CLIENT_SECRET is not configured/);
  });
});
