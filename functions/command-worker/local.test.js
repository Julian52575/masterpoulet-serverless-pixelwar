const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function start(env) {
  const child = spawn(process.execPath, [path.join(__dirname, "local.js")], {
    env: { PATH: process.env.PATH, PORT: "0", PIXEL_EVENTS_TOPIC: "pixel-events", ...env }
  });
  const out = { entries: [], stderr: "" };
  let buffer = "";
  const listening = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buffer += d;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const entry = JSON.parse(line);
        out.entries.push(entry);
        if (entry.message === "command worker listening") resolve(entry.port);
      }
    });
    child.once("exit", (code) => reject(Object.assign(new Error(`exited with ${code}`), { code })));
  });
  child.stderr.on("data", (d) => { out.stderr += d; });
  return { child, out, listening };
}

describe("local.js", () => {
  let worker;
  let baseUrl;

  before(async () => {
    worker = start({ ADMIN_USER_IDS: "999" });
    baseUrl = `http://127.0.0.1:${await worker.listening}`;
  });

  after(() => worker?.child.kill());

  test("answers 400 to a valid push message whose command type is unknown", async () => {
    const body = JSON.stringify({ message: { data: encode({ type: "unknown.command", correlation_id: "c" }) } });
    const res = await fetch(`${baseUrl}/`, { method: "POST", body });
    assert.equal(res.status, 400);
  });

  test("answers 400 to a malformed body", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "POST", body: "not json" });
    assert.equal(res.status, 400);
  });

  test("answers 404 to other routes and methods", async () => {
    assert.equal((await fetch(`${baseUrl}/`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/other`, { method: "POST", body: "{}" })).status, 404);
  });
});

describe("local.js startup", () => {
  test("refuses to start when an admin id is not a Discord snowflake", async () => {
    const { child, out, listening } = start({ ADMIN_USER_IDS: "alice" });
    await assert.rejects(listening, (error) => error.code === 1);
    const entry = JSON.parse(out.stderr.split("\n")[0]);
    assert.equal(entry.severity, "ERROR");
    assert.match(entry.problem, /ADMIN_USER_IDS contains invalid Discord ids: alice/);
    child.kill();
  });

  test("starts but logs a WARNING when no admin is configured", async () => {
    const { child, out, listening } = start({});
    try {
      await listening;
      const warning = out.entries.find((e) => e.message === "configuration warning");
      assert.equal(warning.severity, "WARNING");
      assert.match(warning.warning, /every admin command will be refused/);
    } finally {
      child.kill();
    }
  });

  test("refuses to start when the pixel events topic is not configured", async () => {
    const { child, out, listening } = start({ ADMIN_USER_IDS: "999", PIXEL_EVENTS_TOPIC: "" });
    await assert.rejects(listening, (error) => error.code === 1);
    assert.match(out.stderr, /PIXEL_EVENTS_TOPIC is not configured/);
    child.kill();
  });
});
