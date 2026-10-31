const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvasReader } = require("./canvas");
const { fakeFirestore } = require("./fake-firestore");

const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

describe("visiblePixels", () => {
  test("returns every painted pixel when the canvas was never cleared", async () => {
    const db = fakeFirestore();
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(T0) });
    db.docs.set("pixels/2_2", { x: 2, y: 2, color: "#0000ff", updated_at: new Date(T0) });

    const pixels = await createCanvasReader({ db }).visiblePixels();
    assert.deepEqual(pixels.map((p) => p.color).sort(), ["#0000ff", "#ff0000"]);
  });

  test("hides the pixels erased by a clear that is still being deleted", async () => {
    const db = fakeFirestore();
    db.docs.set("state/canvas", { cleared_at: new Date(T0) });
    db.docs.set("pixels/1_1", { x: 1, y: 1, color: "#ff0000", updated_at: new Date(T0 - 1000) });
    db.docs.set("pixels/2_2", { x: 2, y: 2, color: "#0000ff", updated_at: new Date(T0) });
    db.docs.set("pixels/3_3", { x: 3, y: 3, color: "#00ff00", updated_at: new Date(T0 + 1000) });

    const pixels = await createCanvasReader({ db }).visiblePixels();
    assert.deepEqual(pixels.map((p) => p.color), ["#00ff00"]);
  });

  test("returns nothing on an empty canvas", async () => {
    assert.deepEqual(await createCanvasReader({ db: fakeFirestore() }).visiblePixels(), []);
  });

  test("ignores the other collections", async () => {
    const db = fakeFirestore();
    db.docs.set("limits/111", { limit: 5 });
    assert.deepEqual(await createCanvasReader({ db }).visiblePixels(), []);
  });
});
