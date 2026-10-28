const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const KEY = "a".repeat(64);

function start(env) {
  const child = spawn(process.execPath, [path.join(__dirname, "local.js")], {
    env: { PATH: process.env.PATH, ...env }
  });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => { out.stdout += d; });
  child.stderr.on("data", (d) => { out.stderr += d; });
  return { child, out };
}

function exited(child) {
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

function lines(text) {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("local.js startup", () => {
  test("refuses to start and logs every problem when the configuration is invalid", async () => {
    const { child, out } = start({});
    const code = await exited(child);

    assert.equal(code, 1);
    const problems = lines(out.stderr).map((entry) => entry.problem);
    assert.deepEqual(problems, ["DISCORD_PUBLIC_KEY is not configured", "PUBSUB_TOPIC is not configured"]);
    assert.ok(lines(out.stderr).every((entry) => entry.severity === "ERROR"));
  });

  test("refuses a public key that is not 64 hexadecimal characters", async () => {
    const { child, out } = start({ DISCORD_PUBLIC_KEY: "not-a-key", PUBSUB_TOPIC: "t" });
    assert.equal(await exited(child), 1);
    assert.match(out.stderr, /must be 64 hexadecimal characters/);
  });

  test("starts and logs a JSON line when the configuration is valid", async () => {
    const { child, out } = start({ DISCORD_PUBLIC_KEY: `${KEY}\n`, PUBSUB_TOPIC: "t", PORT: "0" });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.once("data", resolve);
        child.once("exit", (code) => reject(new Error(`exited with ${code}: ${out.stderr}`)));
      });
      const [entry] = lines(out.stdout);
      assert.equal(entry.severity, "INFO");
      assert.equal(entry.message, "discord proxy listening");
    } finally {
      child.kill();
    }
  });
});
