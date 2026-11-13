const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvasReader } = require("./state");
const { fakeFirestore } = require("./fake-firestore");

const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

describe("clearedAt", () => {
  test("is null when the canvas was never cleared", async () => {
    assert.equal(await createCanvasReader({ db: fakeFirestore() }).clearedAt(), null);
  });

  test("returns the time of the last clear", async () => {
    const db = fakeFirestore();
    db.docs.set("state/canvas", { cleared_at: new Date(T0) });
    assert.deepEqual(await createCanvasReader({ db }).clearedAt(), new Date(T0));
  });
});

describe("visiblePixels", () => {
  test("returns the painted pixels", async () => {
    const db = fakeFirestore();
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(T0) });
    assert.equal((await createCanvasReader({ db }).visiblePixels(null)).length, 1);
  });

  test("hides the pixels erased by the last clear", async () => {
    const db = fakeFirestore();
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(T0 - 1) });
    db.docs.set("pixels/2_2", { x: 2, y: 2, color: "#00ff00", updated_at: new Date(T0 + 1) });
    const pixels = await createCanvasReader({ db }).visiblePixels(new Date(T0));
    assert.deepEqual(pixels.map((p) => p.color), ["#00ff00"]);
  });
});

describe("pixelsWrittenSince", () => {
  test("returns only the pixels written after the given time", async () => {
    const db = fakeFirestore();
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(T0), written_at: new Date(T0) });
    db.docs.set("pixels/2_2", { x: 2, y: 2, color: "#00ff00", updated_at: new Date(T0), written_at: new Date(T0 + 10) });
    db.docs.set("pixels/3_3", { x: 3, y: 3, color: "#0000ff", updated_at: new Date(T0) });
    const pixels = await createCanvasReader({ db }).pixelsWrittenSince(new Date(T0));
    assert.deepEqual(pixels.map((p) => p.color), ["#00ff00"]);
  });
});
