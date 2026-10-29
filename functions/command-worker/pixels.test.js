const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createPixelStore, pixelId, tileId } = require("./pixels");
const { fakeFirestore } = require("./fake-firestore");

const MINUTE_START = Date.UTC(2026, 9, 29, 10, 0, 0);

function make({ at = MINUTE_START + 15000 } = {}) {
  const db = fakeFirestore();
  let clock = at;
  const store = createPixelStore({ db, now: () => clock });
  return { db, store, setClock: (value) => { clock = value; } };
}

const request = (extra = {}) => ({
  x: 10,
  y: 20,
  color: "#ff0000",
  author: "111",
  authorName: "Alice",
  drawnAt: new Date(MINUTE_START + 14000),
  limit: 20,
  ...extra
});

describe("pixel and tile ids", () => {
  test("names a pixel by its coordinates", () => {
    assert.equal(pixelId(10, 20), "10_20");
  });

  test("puts a pixel in the 256x256 tile that contains it", () => {
    assert.equal(tileId(0, 0), "0_0");
    assert.equal(tileId(255, 255), "0_0");
    assert.equal(tileId(256, 0), "1_0");
    assert.equal(tileId(9999, 9999), "39_39");
  });
});

describe("draw", () => {
  test("writes the pixel with its color, author, tile and time", async () => {
    const { db, store } = make();
    const result = await store.draw(request());

    assert.deepEqual(result, { status: "drawn", superseded: false, limit: 20, remaining: 19 });
    assert.deepEqual(db.docs.get("pixels/10_20"), {
      x: 10,
      y: 20,
      tile: "0_0",
      color: "#ff0000",
      author: "111",
      author_name: "Alice",
      updated_at: new Date(MINUTE_START + 14000)
    });
  });

  test("does everything in a single transaction", async () => {
    const { db, store } = make();
    await store.draw(request());
    assert.equal(db.transactions, 1);
  });

  test("counts the pixel in the author's counter for the current minute", async () => {
    const { db, store } = make();
    await store.draw(request());
    const counter = db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`);
    assert.equal(counter.count, 1);
    assert.equal(counter.user, "111");
    assert.deepEqual(counter.window_start, new Date(MINUTE_START));
  });

  test("lets Firestore delete old counters an hour after their minute", async () => {
    const { db, store } = make();
    await store.draw(request());
    const counter = db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`);
    assert.deepEqual(counter.expires_at, new Date(MINUTE_START + 60000 + 3600000));
  });

  test("refuses to draw while the canvas is paused, and writes nothing", async () => {
    const { db, store } = make();
    db.docs.set("state/canvas", { paused: true });
    assert.deepEqual(await store.draw(request()), { status: "paused" });
    assert.equal(db.docs.has("pixels/10_20"), false);
    assert.equal([...db.docs.keys()].some((k) => k.startsWith("ratelimit/")), false);
  });

  test("draws again once the canvas is resumed", async () => {
    const { db, store } = make();
    db.docs.set("state/canvas", { paused: false });
    assert.equal((await store.draw(request())).status, "drawn");
  });

  test("stops at the limit and tells when the next minute starts", async () => {
    const { db, store } = make({ at: MINUTE_START + 18000 });
    for (let i = 0; i < 3; i++) {
      assert.equal((await store.draw(request({ x: i, limit: 3 }))).status, "drawn");
    }
    const refused = await store.draw(request({ x: 99, limit: 3 }));

    assert.deepEqual(refused, { status: "rate_limited", limit: 3, retryAfterSeconds: 42 });
    assert.equal(db.docs.has("pixels/99_20"), false);
  });

  test("counts down the remaining pixels", async () => {
    const { store } = make();
    assert.equal((await store.draw(request({ limit: 3 }))).remaining, 2);
    assert.equal((await store.draw(request({ x: 1, limit: 3 }))).remaining, 1);
    assert.equal((await store.draw(request({ x: 2, limit: 3 }))).remaining, 0);
  });

  test("gives a fresh quota in the next minute", async () => {
    const { store, setClock } = make();
    await store.draw(request({ limit: 1 }));
    assert.equal((await store.draw(request({ x: 1, limit: 1 }))).status, "rate_limited");

    setClock(MINUTE_START + 60000 + 1);
    assert.equal((await store.draw(request({ x: 1, limit: 1 }))).status, "drawn");
  });

  test("keeps one quota per user", async () => {
    const { store } = make();
    await store.draw(request({ limit: 1 }));
    assert.equal((await store.draw(request({ author: "222", limit: 1 }))).status, "drawn");
  });

  test("lets the latest draw win on the same pixel", async () => {
    const { db, store } = make();
    await store.draw(request({ color: "#ff0000", drawnAt: new Date(MINUTE_START + 1000) }));
    await store.draw(request({ color: "#00ff00", author: "222", drawnAt: new Date(MINUTE_START + 2000) }));
    assert.equal(db.docs.get("pixels/10_20").color, "#00ff00");
    assert.equal(db.docs.get("pixels/10_20").author, "222");
  });

  test("does not let an older draw delivered late overwrite a newer pixel", async () => {
    const { db, store } = make();
    await store.draw(request({ color: "#00ff00", drawnAt: new Date(MINUTE_START + 2000) }));
    const late = await store.draw(request({ color: "#ff0000", author: "222", drawnAt: new Date(MINUTE_START + 1000) }));

    assert.equal(late.status, "drawn");
    assert.equal(late.superseded, true);
    assert.equal(db.docs.get("pixels/10_20").color, "#00ff00");
  });

  test("compares with Firestore Timestamps too", async () => {
    const { db, store } = make();
    db.docs.set("pixels/10_20", { color: "#00ff00", updated_at: { toMillis: () => MINUTE_START + 5000 } });
    const result = await store.draw(request({ drawnAt: new Date(MINUTE_START + 1000) }));
    assert.equal(result.superseded, true);
    assert.equal(db.docs.get("pixels/10_20").color, "#00ff00");
  });

  test("stores a missing author name as null", async () => {
    const { db, store } = make();
    await store.draw(request({ authorName: undefined }));
    assert.equal(db.docs.get("pixels/10_20").author_name, null);
  });
});

describe("draw idempotency", () => {
  const counterKey = `ratelimit/111_${Math.floor(MINUTE_START / 60000)}`;

  test("records a receipt for the command in the same transaction", async () => {
    const { db, store } = make();
    const result = await store.draw(request({ requestId: "1300000000000000000" }));

    const receipt = db.docs.get("processed/1300000000000000000");
    assert.equal(receipt.command, "draw");
    assert.deepEqual(receipt.result, result);
    assert.deepEqual(receipt.processed_at, new Date(MINUTE_START + 15000));
    assert.deepEqual(receipt.expires_at, new Date(MINUTE_START + 15000 + 24 * 3600000));
    assert.equal(db.transactions, 1);
  });

  test("does not count a pixel twice when the same command is delivered twice", async () => {
    const { db, store } = make();
    const first = await store.draw(request({ requestId: "1300000000000000000" }));
    const second = await store.draw(request({ requestId: "1300000000000000000" }));

    assert.equal(db.docs.get(counterKey).count, 1);
    assert.equal(first.remaining, 19);
    assert.deepEqual(second, { ...first, replayed: true });
  });

  test("still counts two different commands", async () => {
    const { db, store } = make();
    await store.draw(request({ requestId: "1300000000000000000" }));
    await store.draw(request({ requestId: "1300000000000000001", x: 11 }));
    assert.equal(db.docs.get(counterKey).count, 2);
  });

  test("does not take the last pixel of the quota twice", async () => {
    const { store } = make();
    await store.draw(request({ requestId: "a", limit: 2 }));
    await store.draw(request({ requestId: "b", x: 1, limit: 2 }));
    const replay = await store.draw(request({ requestId: "b", x: 1, limit: 2 }));
    assert.equal(replay.status, "drawn");
    assert.equal(replay.remaining, 0);
  });

  test("replays a refusal as a refusal, without writing anything new", async () => {
    const { db, store } = make();
    db.docs.set("state/canvas", { paused: true });
    await store.draw(request({ requestId: "paused-cmd" }));
    db.docs.set("state/canvas", { paused: false });

    const replay = await store.draw(request({ requestId: "paused-cmd" }));
    assert.deepEqual(replay, { status: "paused", superseded: false, replayed: true });
    assert.equal(db.docs.has("pixels/10_20"), false);
  });

  test("marks a replayed draw as superseded when a newer pixel replaced it meanwhile", async () => {
    const { db, store } = make();
    await store.draw(request({ requestId: "old", drawnAt: new Date(MINUTE_START + 1000) }));
    await store.draw(request({ requestId: "new", color: "#00ff00", author: "222", drawnAt: new Date(MINUTE_START + 2000) }));

    const replay = await store.draw(request({ requestId: "old", drawnAt: new Date(MINUTE_START + 1000) }));
    assert.equal(replay.superseded, true);
    assert.equal(db.docs.get("pixels/10_20").color, "#00ff00");
  });

  test("does not deduplicate when there is no request id", async () => {
    const { db, store } = make();
    await store.draw(request());
    await store.draw(request());
    assert.equal(db.docs.get(counterKey).count, 2);
    assert.equal([...db.docs.keys()].some((k) => k.startsWith("processed/")), false);
  });

  test("ignores a request id that could not be a document name", async () => {
    const { db, store } = make();
    await store.draw(request({ requestId: "a/../../pixels/10_20" }));
    assert.equal([...db.docs.keys()].some((k) => k.startsWith("processed/")), false);
    assert.equal(db.docs.get("pixels/10_20").color, "#ff0000");
  });
});

