const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  WRITE_LAG_MS,
  MissingTileError,
  usableBase,
  groupByTile,
  readChanges,
  createTileLoader,
  paintChanges,
  countPixels
} = require("./compose");
const { emptyTile, encodeTile, paint, TILE } = require("./tiles");

const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);
const px = (x, y, color, at) => ({ x, y, color, updated_at: new Date(at) });

describe("usableBase", () => {
  const latest = { version: 1, cleared_at: null, taken_at: new Date(T0).toISOString(), tiles: {} };

  test("uses the latest manifest when the canvas was not cleared since", () => {
    assert.equal(usableBase(latest, null), latest);
    const cleared = new Date(T0 - 1000);
    const afterClear = { ...latest, cleared_at: cleared.toISOString() };
    assert.equal(usableBase(afterClear, cleared), afterClear);
  });

  test("ignores it after a clear, with another version, or when there is none", () => {
    assert.equal(usableBase(latest, new Date(T0)), null);
    assert.equal(usableBase({ ...latest, version: 2 }, null), null);
    assert.equal(usableBase(null, null), null);
  });
});

describe("groupByTile", () => {
  test("groups pixels by 256x256 tile, oldest first so the newest wins", () => {
    const groups = groupByTile([px(1, 1, "#000002", T0 + 2), px(300, 1, "#000003", T0), px(1, 1, "#000001", T0 + 1)], null);
    assert.deepEqual([...groups.keys()].sort(), ["0_0", "1_0"]);
    assert.deepEqual(groups.get("0_0").map((p) => p.color), ["#000001", "#000002"]);
  });

  test("drops malformed pixels and pixels erased by a clear", () => {
    const groups = groupByTile([px(-1, 0, "#ffffff", T0), px(0, 0, "red", T0), px(5, 5, "#ffffff", T0 - 1)], new Date(T0 - 1));
    assert.equal(groups.size, 0);
  });
});

describe("readChanges", () => {
  test("asks only for the pixels written since the base, minus the lag margin", async () => {
    const calls = [];
    const canvas = { pixelsWrittenSince: async (since) => { calls.push(since); return [px(1, 1, "#ff0000", T0)]; } };
    const { read, groups } = await readChanges({ canvas, base: { taken_at: new Date(T0).toISOString() }, cleared: null });
    assert.deepEqual(calls, [new Date(T0 - WRITE_LAG_MS)]);
    assert.equal(read, 1);
    assert.equal(groups.size, 1);
  });

  test("reads every visible pixel when there is no base", async () => {
    const cleared = new Date(T0);
    const canvas = { visiblePixels: async (value) => { assert.equal(value, cleared); return []; } };
    assert.equal((await readChanges({ canvas, base: null, cleared })).read, 0);
  });
});

describe("paintChanges and countPixels", () => {
  test("paints the changes on top of the stored tile", async () => {
    const stored = emptyTile();
    paint(stored, 0, 0, { x: 0, y: 0, color: "#ff0000" });
    const loadTile = createTileLoader(async (object) => (object === "tiles/0_0/a.png" ? encodeTile(stored) : null));
    const tiles = { "0_0": { object: "tiles/0_0/a.png", pixels: 1 }, "1_0": { object: "tiles/1_0/a.png", pixels: 7 } };

    const painted = await paintChanges({ groups: groupByTile([px(1, 0, "#00ff00", T0)], null), tiles, loadTile });

    const rgba = painted.get("0_0");
    assert.deepEqual([...rgba.subarray(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
    assert.equal(countPixels(tiles, painted), 2 + 7);
  });

  test("starts from a transparent tile for a tile never painted", async () => {
    const painted = await paintChanges({ groups: groupByTile([px(TILE, 0, "#0000ff", T0)], null), tiles: {}, loadTile: async () => assert.fail() });
    assert.equal(countPixels({}, painted), 1);
  });

  test("reports a missing tile so the caller can rebuild", async () => {
    const loadTile = createTileLoader(async () => null);
    await assert.rejects(
      paintChanges({ groups: groupByTile([px(0, 0, "#0000ff", T0)], null), tiles: { "0_0": { object: "gone.png", pixels: 1 } }, loadTile }),
      MissingTileError
    );
  });
});
