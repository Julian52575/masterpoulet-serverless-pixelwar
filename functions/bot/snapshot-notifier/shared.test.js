const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commandWorker = path.join(__dirname, "..", "command-worker");
const snapshotWorker = path.join(__dirname, "..", "snapshot-worker");

describe("code shared with the other services", () => {
  test("discord.js is identical to the command-worker's", () => {
    assert.equal(
      fs.readFileSync(path.join(__dirname, "discord.js"), "utf8"),
      fs.readFileSync(path.join(commandWorker, "discord.js"), "utf8"),
      "copy discord.js again from functions/bot/command-worker"
    );
  });

  test("logger.js only differs by the default service name", () => {
    const own = fs.readFileSync(path.join(__dirname, "logger.js"), "utf8");
    const theirs = fs.readFileSync(path.join(commandWorker, "logger.js"), "utf8");
    assert.equal(own.replace('"snapshot-notifier"', '"command-worker"'), theirs);
  });

  test("looks for snapshots where the snapshot-worker stores them", () => {
    assert.equal(require("./notifier").SNAPSHOT_PREFIX, require(path.join(snapshotWorker, "storage")).SNAPSHOT_PREFIX);
  });
});
