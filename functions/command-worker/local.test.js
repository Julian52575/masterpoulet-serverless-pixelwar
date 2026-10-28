const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

let child;
let baseUrl;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "local.js")], {
    env: { PATH: process.env.PATH, PORT: "0" }
  });
  const line = await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(new Error(`exited with ${code}`)));
  });
  const entry = JSON.parse(String(line).split("\n")[0]);
  assert.equal(entry.message, "command worker listening");
  assert.ok(entry.port > 0);
  baseUrl = `http://127.0.0.1:${entry.port}`;
});

after(() => child?.kill());

describe("local.js", () => {
  test("answers 400 to a valid push message whose command has no handler yet", async () => {
    const body = JSON.stringify({ message: { data: encode({ type: "draw", correlation_id: "c" }) } });
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
