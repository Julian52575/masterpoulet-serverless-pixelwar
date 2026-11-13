const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "snapshot-notifier";
const bot = path.join(__dirname, "..");
const read = (service, file) => fs.readFileSync(path.join(bot, service, file), "utf8");

const SHARED = {
  "discord.js": ["admin-cmd", "draw-pixel", "get-canvas"]
};

const LOGGERS = ["discord-proxy", "draw-pixel", "admin-cmd", "get-canvas", "snapshot-worker", "web-proxy", "web-auth"];

describe("code shared with the other services", () => {
  for (const [file, services] of Object.entries(SHARED)) {
    for (const other of services) {
      test(`${file} is identical in ${other}`, () => {
        assert.equal(read(SERVICE, file), read(other, file), `apply the same change to functions/bot/${other}/${file}`);
      });
    }
  }

  for (const other of LOGGERS) {
    test(`logger.js only differs from the ${other} one by the default service name`, () => {
      assert.equal(
        read(SERVICE, "logger.js").replace(`"${SERVICE}"`, '"<service>"'),
        read(other, "logger.js").replace(`"${other}"`, '"<service>"')
      );
    });
  }

  test("looks for snapshots where the snapshot-worker stores them", () => {
    assert.equal(require("./notifier").SNAPSHOT_PREFIX, require(path.join(bot, "snapshot-worker", "storage")).SNAPSHOT_PREFIX);
  });

  test("ignores the tiles and manifests snapshot-worker writes in the same bucket", () => {
    const { SNAPSHOT_PREFIX } = require("./notifier");
    const storage = require(path.join(bot, "snapshot-worker", "storage"));
    for (const prefix of [storage.TILE_PREFIX, storage.MANIFEST_PREFIX]) {
      assert.ok(!prefix.startsWith(SNAPSHOT_PREFIX), prefix);
    }
  });

  test("posts only the first of two real scheduled snapshots of the same hour", async () => {
    const { fakeFirestore } = require(path.join(bot, "snapshot-worker", "fake-firestore"));
    const { createSnapshotTaker } = require(path.join(bot, "snapshot-worker", "snapshot"));
    const { createCanvasReader } = require(path.join(bot, "snapshot-worker", "state"));
    const { createNotifier } = require("./notifier");

    const db = fakeFirestore();
    const objects = new Map();
    let latest = null;
    const store = {
      save: async ({ name, metadata }) => { objects.set(name, { metadata }); return name; },
      saveTile: async (name, png) => { objects.set(name, { png }); },
      readTile: async (name) => objects.get(name)?.png ?? null,
      latestManifest: async () => latest,
      saveManifest: async (name, manifest) => { objects.set(name, { json: manifest }); latest = JSON.parse(JSON.stringify(manifest)); }
    };
    const T0 = Date.UTC(2026, 10, 13, 13, 10, 0);
    let clock = T0;
    const take = createSnapshotTaker({ canvas: createCanvasReader({ db }), store, now: () => new Date(clock) });
    const draw = (x, at) => db.docs.set(`pixels/${x}_0`, { x, y: 0, color: "#ff0000", updated_at: new Date(at), written_at: new Date(at) });

    draw(1, T0 - 600000);
    const first = await take({ type: "snapshot.scheduled" }, { messageId: "1", publishTime: new Date(T0).toISOString() });
    clock = T0 + 20 * 60000;
    draw(2, clock - 60000);
    const second = await take({ type: "snapshot.scheduled" }, { messageId: "2", publishTime: new Date(clock).toISOString() });

    const posts = [];
    const notifier = createNotifier({
      files: {
        metadataOf: async (name) => objects.get(name).metadata,
        signedUrl: async () => "https://signed",
        readJson: async (name) => objects.get(name)?.json ?? null
      },
      discord: { editOriginal: async () => assert.fail() },
      bucket: "snaps",
      ttlMinutes: 60,
      webhook: { post: async (message) => posts.push(message) },
      postEveryMinutes: 60
    });
    const push = (name) => [{}, Buffer.from(JSON.stringify({ message: { attributes: { eventType: "OBJECT_FINALIZE", bucketId: "snaps", objectId: name }, messageId: name } }))];

    const original = console.log;
    console.log = () => {};
    try {
      await notifier(...push(first.name));
      await notifier(...push(second.name));
    } finally {
      console.log = original;
    }
    assert.equal(JSON.parse(JSON.stringify(objects.get(objects.get(second.name).metadata.manifest).json)).previous, first.manifest);
    assert.equal(posts.length, 1);
    assert.match(posts[0].content, /Scheduled snapshot from 2026-11-13 13:10:00 UTC/);
  });
});
