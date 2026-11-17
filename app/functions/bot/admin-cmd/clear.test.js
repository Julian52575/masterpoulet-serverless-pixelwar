const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvasCleaner } = require("./clear");
const { fakeFirestore } = require("./fake-firestore");

const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

function paint(db, x, y, at) {
  db.docs.set(`pixels/${x}_${y}`, { x, y, color: "#ff0000", updated_at: new Date(at) });
}

describe("clearBefore", () => {
  test("deletes every pixel drawn up to the clear time and returns how many", async () => {
    const db = fakeFirestore();
    paint(db, 1, 1, T0 - 5000);
    paint(db, 2, 2, T0 - 1000);
    paint(db, 3, 3, T0);

    const deleted = await createCanvasCleaner({ db }).clearBefore(new Date(T0));

    assert.equal(deleted, 3);
    assert.equal([...db.docs.keys()].filter((k) => k.startsWith("pixels/")).length, 0);
  });

  test("keeps the pixels drawn after the clear", async () => {
    const db = fakeFirestore();
    paint(db, 1, 1, T0 - 1000);
    paint(db, 2, 2, T0 + 1000);

    await createCanvasCleaner({ db }).clearBefore(new Date(T0));

    assert.equal(db.docs.has("pixels/1_1"), false);
    assert.equal(db.docs.has("pixels/2_2"), true);
  });

  test("deletes page by page so that a huge canvas fits in Firestore batch limits", async () => {
    const db = fakeFirestore();
    for (let i = 0; i < 5; i++) paint(db, i, 0, T0 - 1000);

    const deleted = await createCanvasCleaner({ db, pageSize: 2 }).clearBefore(new Date(T0));

    assert.equal(deleted, 5);
    assert.equal(db.batches, 3);
  });

  test("does nothing on an empty canvas", async () => {
    const db = fakeFirestore();
    assert.equal(await createCanvasCleaner({ db }).clearBefore(new Date(T0)), 0);
    assert.equal(db.batches, 0);
  });

  test("can run twice safely: the second run finds nothing left", async () => {
    const db = fakeFirestore();
    paint(db, 1, 1, T0 - 1000);
    const cleaner = createCanvasCleaner({ db });
    assert.equal(await cleaner.clearBefore(new Date(T0)), 1);
    assert.equal(await cleaner.clearBefore(new Date(T0)), 0);
  });

  test("only touches the pixels collection", async () => {
    const db = fakeFirestore();
    paint(db, 1, 1, T0 - 1000);
    db.docs.set("limits/111", { limit: 5, updated_at: new Date(T0 - 1000) });
    db.docs.set("state/canvas", { paused: false, updated_at: new Date(T0 - 1000) });

    await createCanvasCleaner({ db }).clearBefore(new Date(T0));

    assert.equal(db.docs.has("limits/111"), true);
    assert.equal(db.docs.has("state/canvas"), true);
  });
});
