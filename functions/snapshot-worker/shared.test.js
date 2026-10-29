const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commandWorker = path.join(__dirname, "..", "command-worker");

describe("code shared with the command-worker", () => {
  for (const file of ["envelope.js", "png.js", "render.js", "fake-firestore.js"]) {
    test(`${file} is identical in both services`, () => {
      assert.equal(
        fs.readFileSync(path.join(__dirname, file), "utf8"),
        fs.readFileSync(path.join(commandWorker, file), "utf8"),
        `copy ${file} again from functions/command-worker`
      );
    });
  }

  test("logger.js only differs by the default service name", () => {
    const own = fs.readFileSync(path.join(__dirname, "logger.js"), "utf8");
    const theirs = fs.readFileSync(path.join(commandWorker, "logger.js"), "utf8");
    assert.equal(own.replace('"snapshot-worker"', '"command-worker"'), theirs);
  });

  test("reads the same Firestore collections as the command-worker writes", () => {
    const own = require("./state");
    const theirs = require(path.join(commandWorker, "state"));
    const pixels = require(path.join(commandWorker, "pixels"));
    assert.equal(own.STATE_COLLECTION, theirs.STATE_COLLECTION);
    assert.equal(own.CANVAS_DOC, theirs.CANVAS_DOC);
    assert.equal(own.PIXELS_COLLECTION, pixels.PIXELS_COLLECTION);
  });

  test("converts Firestore dates the same way", () => {
    const own = require("./state");
    const theirs = require(path.join(commandWorker, "state"));
    for (const value of [new Date(5), { toMillis: () => 7 }, undefined, null]) {
      assert.equal(own.toMillis(value), theirs.toMillis(value));
    }
  });
});
