const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("./config");

const VALID = {
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "secret\n",
  OAUTH_REDIRECT_URI: "https://pixelwar.example/api/auth/callback",
  APP_URL: "https://pixelwar.example/"
};

describe("loadConfig", () => {
  test("reads a complete configuration and trims the secret", () => {
    const config = loadConfig(VALID);
    assert.deepEqual(config.problems, []);
    assert.equal(config.clientSecret, "secret");
    assert.equal(config.redirectUri, "https://pixelwar.example/api/auth/callback");
  });

  test("accepts http only on localhost, for local runs", () => {
    const config = loadConfig({ ...VALID, OAUTH_REDIRECT_URI: "http://localhost:8080/auth/callback", APP_URL: "http://127.0.0.1:5173" });
    assert.deepEqual(config.problems, []);
  });

  test("reports every missing variable at once", () => {
    assert.deepEqual(loadConfig({}).problems, [
      "DISCORD_CLIENT_ID is not configured",
      "DISCORD_CLIENT_SECRET is not configured",
      "OAUTH_REDIRECT_URI must be an https URL without a fragment",
      "APP_URL must be an https URL without a fragment"
    ]);
  });

  test("refuses a client id that is not a Discord id", () => {
    assert.deepEqual(loadConfig({ ...VALID, DISCORD_CLIENT_ID: "my-app" }).problems, ["DISCORD_CLIENT_ID must be a Discord application id"]);
  });

  for (const url of ["http://pixelwar.example/cb", "https://pixelwar.example/cb#x", "javascript:alert(1)", "not a url", "https://user:pw@pixelwar.example/"]) {
    test(`refuses the redirect URI ${url}`, () => {
      assert.equal(loadConfig({ ...VALID, OAUTH_REDIRECT_URI: url }).problems.length, 1);
    });
  }
});
