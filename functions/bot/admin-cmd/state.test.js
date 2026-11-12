const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvasState } = require("./state");
const { fakeFirestore: fakeDb } = require("./fake-firestore");

describe("canvas state", () => {
  test("is not paused when nothing was ever written", async () => {
    const state = createCanvasState({ db: fakeDb() });
    assert.equal(await state.isPaused(), false);
  });

  test("stores the pause flag in state/canvas with who and when", async () => {
    const db = fakeDb();
    const before = Date.now();
    await createCanvasState({ db }).setPaused(true, "999");

    const doc = db.docs.get("state/canvas");
    assert.equal(doc.paused, true);
    assert.equal(doc.updated_by, "999");
    assert.ok(doc.updated_at instanceof Date);
    assert.ok(doc.updated_at.getTime() >= before);
  });

  test("reads back the pause flag", async () => {
    const state = createCanvasState({ db: fakeDb() });
    await state.setPaused(true, "999");
    assert.equal(await state.isPaused(), true);
    await state.setPaused(false, "999");
    assert.equal(await state.isPaused(), false);
  });

  test("keeps the other fields of state/canvas (merge)", async () => {
    const db = fakeDb();
    db.docs.set("state/canvas", { size: 10000 });
    await createCanvasState({ db }).setPaused(true, "999");
    assert.equal(db.docs.get("state/canvas").size, 10000);
  });

  test("gives the same result when the same pause is applied twice", async () => {
    const db = fakeDb();
    const state = createCanvasState({ db });
    await state.setPaused(true, "999");
    await state.setPaused(true, "999");
    assert.equal(await state.isPaused(), true);
  });

  test("only treats paused === true as paused", async () => {
    const db = fakeDb();
    db.docs.set("state/canvas", { paused: "yes" });
    assert.equal(await createCanvasState({ db }).isPaused(), false);
  });
});

describe("canvas clear time", () => {
  const T0 = Date.UTC(2026, 9, 29, 10, 0, 0);

  test("records when the canvas was cleared and by whom", async () => {
    const db = fakeDb();
    assert.equal(await createCanvasState({ db }).setCleared(new Date(T0), "999"), true);
    assert.deepEqual(db.docs.get("state/canvas").cleared_at, new Date(T0));
    assert.equal(db.docs.get("state/canvas").cleared_by, "999");
  });

  test("keeps the pause flag when clearing", async () => {
    const db = fakeDb();
    db.docs.set("state/canvas", { paused: true });
    await createCanvasState({ db }).setCleared(new Date(T0), "999");
    assert.equal(db.docs.get("state/canvas").paused, true);
  });

  test("never moves the clear time backwards (an old clear replayed late)", async () => {
    const db = fakeDb();
    const state = createCanvasState({ db });
    await state.setCleared(new Date(T0 + 5000), "999");
    assert.equal(await state.setCleared(new Date(T0), "888"), false);
    assert.deepEqual(db.docs.get("state/canvas").cleared_at, new Date(T0 + 5000));
    assert.equal(db.docs.get("state/canvas").cleared_by, "999");
  });

  test("accepts the same clear replayed (idempotent)", async () => {
    const db = fakeDb();
    const state = createCanvasState({ db });
    await state.setCleared(new Date(T0), "999");
    assert.equal(await state.setCleared(new Date(T0), "999"), false);
    assert.deepEqual(db.docs.get("state/canvas").cleared_at, new Date(T0));
  });
});
