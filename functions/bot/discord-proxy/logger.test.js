const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { log } = require("./logger");

function capture(method, fn) {
  const spy = mock.method(console, method, () => {});
  try {
    fn();
    return spy.mock.calls.map((call) => call.arguments[0]);
  } finally {
    spy.mock.restore();
  }
}

describe("logger", () => {
  test("writes a single JSON line with the Cloud Logging fields", () => {
    const [line] = capture("log", () => log.info("hello", { correlation_id: "abc" }));
    assert.ok(!line.includes("\n"));
    const entry = JSON.parse(line);
    assert.equal(entry.severity, "INFO");
    assert.equal(entry.message, "hello");
    assert.equal(entry.function, "discord-proxy");
    assert.equal(entry.correlation_id, "abc");
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  });

  test("uses WARNING as the Cloud Logging severity for warn", () => {
    const [line] = capture("log", () => log.warn("careful"));
    assert.equal(JSON.parse(line).severity, "WARNING");
  });

  test("writes errors to stderr", () => {
    const stdout = capture("log", () => {
      const stderr = capture("error", () => log.error("boom"));
      assert.equal(JSON.parse(stderr[0]).severity, "ERROR");
    });
    assert.equal(stdout.length, 0);
  });

  test("does not let fields override severity, message or function", () => {
    const [line] = capture("log", () =>
      log.info("real", { severity: "DEBUG", message: "fake", function: "other" })
    );
    const entry = JSON.parse(line);
    assert.equal(entry.severity, "INFO");
    assert.equal(entry.message, "real");
    assert.equal(entry.function, "discord-proxy");
  });

  test("works without extra fields", () => {
    const [line] = capture("log", () => log.info("plain"));
    assert.equal(JSON.parse(line).message, "plain");
  });
});
