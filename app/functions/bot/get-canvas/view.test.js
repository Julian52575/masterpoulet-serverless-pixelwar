const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { createCanvasView } = require("./view");
const { createCanvasReader } = require("./canvas");
const { fakeFirestore } = require("./fake-firestore");
const { emptyTile, encodeTile, paint } = require("./tiles");

const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);

function pixelAt(png, x, y) {
  const width = png.readUInt32BE(16);
  const idat = png.indexOf("IDAT");
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  const at = y * (width * 3 + 1) + 1 + x * 3;
  return `#${raw.subarray(at, at + 3).toString("hex")}`;
}

function setup({ manifest = null, objects = {} } = {}) {
  const db = fakeFirestore();
  const reads = [];
  const store = {
    latestManifest: async () => manifest,
    readTile: async (name) => { reads.push(name); return objects[name] ?? null; }
  };
  const view = createCanvasView({ canvas: createCanvasReader({ db }), store });
  const draw = (x, y, color, at) => db.docs.set(`pixels/${x}_${y}`, { x, y, color, updated_at: new Date(at), written_at: new Date(at) });
  return { db, view, draw, reads };
}

function storedTile(tx, ty, pixels) {
  const rgba = emptyTile();
  for (const p of pixels) paint(rgba, tx, ty, p);
  return encodeTile(rgba);
}

const manifestWith = (tiles, extra = {}) => ({
  version: 1,
  name: "manifests/a.json",
  taken_at: new Date(T0).toISOString(),
  cleared_at: null,
  tiles,
  ...extra
});

async function quiet(fn) {
  const out = mock.method(console, "log", () => {});
  try {
    return await fn();
  } finally {
    out.mock.restore();
  }
}

describe("createCanvasView", () => {
  test("starts from the latest snapshot and adds only the pixels written since", async () => {
    const { view, draw, db } = setup({
      manifest: manifestWith({ "0_0": { object: "tiles/0_0/a.png", pixels: 1 } }),
      objects: { "tiles/0_0/a.png": storedTile(0, 0, [{ x: 10, y: 10, color: "#ff0000" }]) }
    });
    db.docs.set("pixels/10_10", { x: 10, y: 10, color: "#ff0000", updated_at: new Date(T0 - 3600000), written_at: new Date(T0 - 3600000) });
    draw(20, 10, "#00ff00", T0 + 60000);

    const image = await view();

    assert.equal(image.source, "snapshot");
    assert.equal(image.snapshot, "manifests/a.json");
    assert.equal(image.pixelsRead, 1);
    assert.equal(image.count, 2);
    assert.equal(pixelAt(image.png, 10, 10), "#ff0000");
    assert.equal(pixelAt(image.png, 20, 10), "#00ff00");
  });

  test("reuses the stored tiles that did not change, without touching Firestore for them", async () => {
    const { view, reads } = setup({
      manifest: manifestWith({ "3_3": { object: "tiles/3_3/a.png", pixels: 1 } }),
      objects: { "tiles/3_3/a.png": storedTile(3, 3, [{ x: 800, y: 800, color: "#0000ff" }]) }
    });
    const image = await view();

    assert.equal(image.pixelsRead, 0);
    assert.equal(image.changedTiles, 0);
    assert.deepEqual(reads, ["tiles/3_3/a.png"]);
    assert.deepEqual(image.region, { x0: 768, y0: 768, x1: 1023, y1: 1023 });
    assert.equal(pixelAt(image.png, 800 - 768, 800 - 768), "#0000ff");
  });

  test("reads the whole canvas from Firestore when there is no snapshot yet", async () => {
    const { view, draw } = setup();
    draw(5, 5, "#123456", T0);
    const image = await view();

    assert.equal(image.source, "firestore");
    assert.equal(image.count, 1);
  });

  test("ignores a snapshot taken before the last /admin clear", async () => {
    const { view, draw, db } = setup({
      manifest: manifestWith({ "0_0": { object: "tiles/0_0/a.png", pixels: 1 } }),
      objects: { "tiles/0_0/a.png": storedTile(0, 0, [{ x: 10, y: 10, color: "#ff0000" }]) }
    });
    db.docs.set("state/canvas", { cleared_at: new Date(T0 + 1000) });
    draw(300, 300, "#00ff00", T0 + 2000);

    const image = await view();
    assert.equal(image.source, "firestore");
    assert.equal(image.count, 1);
    assert.deepEqual(image.region, { x0: 256, y0: 256, x1: 511, y1: 511 });
  });

  test("falls back to Firestore when a tile of the snapshot is missing", async () => {
    const { view, draw } = setup({ manifest: manifestWith({ "0_0": { object: "tiles/0_0/gone.png", pixels: 1 } }) });
    draw(1, 1, "#ff0000", T0 - 1000);

    const image = await quiet(() => view());
    assert.equal(image.source, "firestore");
    assert.equal(image.count, 1);
  });

  test("shows an empty canvas", async () => {
    const image = await setup().view();
    assert.equal(image.count, 0);
    assert.equal(image.region, null);
  });

  test("lets a bucket error reach the worker, so Pub/Sub retries", async () => {
    const db = fakeFirestore();
    const store = { latestManifest: async () => { throw new Error("503"); }, readTile: async () => null };
    await assert.rejects(createCanvasView({ canvas: createCanvasReader({ db }), store })(), /503/);
  });
});
