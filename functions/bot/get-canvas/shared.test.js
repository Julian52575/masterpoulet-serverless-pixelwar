const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commandWorker = path.join(__dirname, "..", "command-worker");

describe("code shared with the command-worker", () => {
  for (const file of [
    "envelope.js",
    "canvas.js",
    "pixels.js",
    "grid.js",
    "state.js",
    "render.js",
    "png.js",
    "reply.js",
    "discord.js",
    "fake-firestore.js"
  ]) {
    test(`${file} is identical in both services`, () => {
      assert.equal(
        fs.readFileSync(path.join(__dirname, file), "utf8"),
        fs.readFileSync(path.join(commandWorker, file), "utf8"),
        `copy ${file} again from functions/bot/command-worker`
      );
    });
  }

  test("logger.js only differs by the default service name", () => {
    const own = fs.readFileSync(path.join(__dirname, "logger.js"), "utf8");
    const theirs = fs.readFileSync(path.join(commandWorker, "logger.js"), "utf8");
    assert.equal(own.replace('"get-canvas"', '"command-worker"'), theirs);
  });
});
