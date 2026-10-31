const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

function start(env) {
  const child = spawn(process.execPath, [path.join(__dirname, "local.js")], {
    env: { PATH: process.env.PATH, PORT: "0", ...env }
  });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => { out.stdout += d; });
  child.stderr.on("data", (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  return { child, out, exited };
}

describe("local.js startup", () => {
  test("refuses to start without a snapshot bucket", async () => {
    const { out, exited } = start({});
    assert.equal(await exited, 1);
    assert.match(out.stderr, /SNAPSHOT_BUCKET is not configured/);
  });

  test("starts and answers 404 outside of the push route", async () => {
    const { child, out } = start({ SNAPSHOT_BUCKET: "teamx-dev-snapshots" });
    try {
      const port = await new Promise((resolve, reject) => {
        child.stdout.once("data", (d) => resolve(JSON.parse(String(d).split("\n")[0]).port));
        child.once("exit", (code) => reject(new Error(`exited with ${code}: ${out.stderr}`)));
      });
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "not json" })).status, 400);
    } finally {
      child.kill();
    }
  });
});
