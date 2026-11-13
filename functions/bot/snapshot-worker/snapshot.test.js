const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshotTaker, snapshotName, InvalidRequestError, WRITE_LAG_MS } = require("./snapshot");
const { createCanvasReader } = require("./state");
const { fakeFirestore } = require("./fake-firestore");
const { decodeTile, countPainted, TILE } = require("./tiles");
const { SIGNATURE } = require("./png");

const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

function fakeStore() {
  const objects = new Map();
  let latest = null;
  const reads = [];
  return {
    objects,
    reads,
    get latest() { return latest; },
    save: async ({ name, png, metadata }) => { objects.set(name, { data: png, metadata }); return `gs://snaps/${name}`; },
    saveTile: async (name, png) => { objects.set(name, { data: png }); },
    readTile: async (name) => { reads.push(name); return objects.get(name)?.data ?? null; },
    latestManifest: async () => (latest ? JSON.parse(latest) : null),
    saveManifest: async (name, manifest) => {
      const json = JSON.stringify(manifest);
      objects.set(name, { data: Buffer.from(json) });
      latest = json;
    }
  };
}

function setup() {
  const db = fakeFirestore();
  const store = fakeStore();
  let clock = T0;
  const take = createSnapshotTaker({ canvas: createCanvasReader({ db }), store, now: () => new Date(clock) });
  const draw = (x, y, color, at) => db.docs.set(`pixels/${x}_${y}`, { x, y, color, updated_at: new Date(at), written_at: new Date(at) });
  return { db, store, take, draw, setClock: (value) => { clock = value; } };
}

const request = (id, at, extra = {}) => ({
  type: "snapshot.requested",
  snapshot_id: id,
  requested_at: new Date(at).toISOString(),
  requested_by: "999",
  application_id: "123456789012345678",
  interaction_token: "secret-token",
  channel_id: "555",
  correlation_id: "corr-7",
  ...extra
});

const manifestOf = (store, result) => JSON.parse(store.objects.get(result.manifest).data);
const tileColor = (store, object, x, y) => {
  const rgba = decodeTile(store.objects.get(object).data);
  const at = ((y % TILE) * TILE + (x % TILE)) * 4;
  return rgba[at + 3] === 0 ? null : `#${rgba.subarray(at, at + 3).toString("hex")}`;
};

async function quiet(fn) {
  const out = mock.method(console, "log", () => {});
  try {
    return await fn();
  } finally {
    out.mock.restore();
  }
}

describe("snapshotName", () => {
  test("puts the time and the command id in the name, with only safe characters", () => {
    const name = snapshotName(new Date("2026-10-29T12:43:03.572Z"), "1565345221745573888");
    assert.equal(name, "snapshots/2026-10-29T12-43-03-572Z_1565345221745573888.png");
  });
});

describe("first snapshot (full build)", () => {
  test("writes one PNG per painted tile, a manifest and the overview image", async () => {
    const { store, take, draw } = setup();
    draw(10, 20, "#ff0000", T0 - 5000);
    draw(300, 20, "#00ff00", T0 - 4000);

    const result = await take(request("1", T0));

    assert.equal(result.mode, "full");
    assert.equal(result.count, 2);
    assert.equal(result.changedTiles, 2);
    assert.equal(result.name, "snapshots/2026-11-13T12-00-00-000Z_1.png");
    assert.deepEqual(store.objects.get(result.name).data.subarray(0, 8), SIGNATURE);

    const manifest = manifestOf(store, result);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.mode, "full");
    assert.equal(manifest.previous, null);
    assert.equal(manifest.taken_at, new Date(T0).toISOString());
    assert.deepEqual(manifest.changed_tiles, ["0_0", "1_0"]);
    assert.deepEqual(manifest.tiles["0_0"], { object: "tiles/0_0/2026-11-13T12-00-00-000Z_1.png", pixels: 1 });
    assert.equal(tileColor(store, manifest.tiles["0_0"].object, 10, 20), "#ff0000");
    assert.equal(tileColor(store, manifest.tiles["1_0"].object, 300, 20), "#00ff00");
  });

  test("keeps what the notifier needs in the overview metadata, and no secret in the manifest", async () => {
    const { store, take, draw } = setup();
    draw(1, 1, "#ff0000", T0 - 1);
    const result = await take(request("1", T0));

    assert.deepEqual(store.objects.get(result.name).metadata, {
      snapshot_id: "1",
      requested_at: new Date(T0).toISOString(),
      requested_by: "999",
      pixel_count: "1",
      manifest: result.manifest,
      application_id: "123456789012345678",
      interaction_token: "secret-token",
      channel_id: "555",
      correlation_id: "corr-7"
    });
    assert.ok(!store.objects.get(result.manifest).data.toString().includes("secret-token"));
  });

  test("stores the overview last, so the notifier only fires once everything is saved", async () => {
    const { store, take, draw } = setup();
    draw(1, 1, "#ff0000", T0 - 1);
    await take(request("1", T0));
    assert.ok([...store.objects.keys()].at(-1).startsWith("snapshots/"));
  });

  test("snapshots an empty canvas", async () => {
    const { store, take } = setup();
    const result = await take(request("1", T0));
    assert.equal(result.count, 0);
    assert.deepEqual(manifestOf(store, result).tiles, {});
  });
});

describe("next snapshots (incremental)", () => {
  test("only re-renders the tiles changed since the previous snapshot", async () => {
    const { store, take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 10 * 60 * 1000);
    draw(300, 20, "#00ff00", T0 - 10 * 60 * 1000);
    const first = await take(request("1", T0));

    setClock(T0 + 10 * 60 * 1000);
    draw(11, 20, "#0000ff", T0 + 5 * 60 * 1000);
    const second = await take(request("2", T0 + 10 * 60 * 1000));

    const manifest = manifestOf(store, second);
    assert.equal(second.mode, "incremental");
    assert.equal(manifest.previous, first.manifest);
    assert.deepEqual(manifest.changed_tiles, ["0_0"]);
    assert.equal(manifest.tiles["1_0"].object, manifestOf(store, first).tiles["1_0"].object);
    assert.notEqual(manifest.tiles["0_0"].object, manifestOf(store, first).tiles["0_0"].object);
    assert.equal(tileColor(store, manifest.tiles["0_0"].object, 10, 20), "#ff0000");
    assert.equal(tileColor(store, manifest.tiles["0_0"].object, 11, 20), "#0000ff");
    assert.equal(second.count, 3);
  });

  test("re-reads a pixel written just before the previous snapshot once, then no more", async () => {
    const { take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 1000);
    await take(request("1", T0));

    setClock(T0 + 10 * 60 * 1000);
    assert.equal((await take(request("2", T0 + 10 * 60 * 1000))).pixelsRead, 1);

    setClock(T0 + 20 * 60 * 1000);
    assert.equal((await take(request("3", T0 + 20 * 60 * 1000))).pixelsRead, 0);
  });

  test("reads Firestore only for the pixels written since the previous snapshot", async () => {
    const { take, draw, setClock } = setup();
    for (let x = 0; x < 50; x++) draw(x, 0, "#ff0000", T0 - 10 * 60 * 1000);
    await take(request("1", T0));

    setClock(T0 + 10 * 60 * 1000);
    draw(60, 0, "#00ff00", T0 + 9 * 60 * 1000);
    const second = await take(request("2", T0 + 10 * 60 * 1000));

    assert.equal(second.pixelsRead, 1);
  });

  test("still catches a pixel written late, within the lag margin", async () => {
    const { store, db, take, setClock } = setup();
    await take(request("1", T0));

    db.docs.set("pixels/5_5", { x: 5, y: 5, color: "#abcdef", updated_at: new Date(T0 - 60000), written_at: new Date(T0 - WRITE_LAG_MS + 1) });
    setClock(T0 + 60000);
    const second = await take(request("2", T0 + 60000));

    assert.equal(tileColor(store, manifestOf(store, second).tiles["0_0"].object, 5, 5), "#abcdef");
  });

  test("lets a newer color replace the old one in a tile", async () => {
    const { store, take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 5000);
    await take(request("1", T0));

    setClock(T0 + 60000);
    draw(10, 20, "#000000", T0 + 30000);
    const second = await take(request("2", T0 + 60000));

    assert.equal(tileColor(store, manifestOf(store, second).tiles["0_0"].object, 10, 20), "#000000");
    assert.equal(second.count, 1);
  });

  test("starts again from an empty canvas after /admin clear", async () => {
    const { store, db, take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 5000);
    await take(request("1", T0));

    db.docs.set("state/canvas", { cleared_at: new Date(T0 + 1000) });
    db.docs.delete("pixels/10_20");
    draw(400, 400, "#00ff00", T0 + 2000);
    setClock(T0 + 60000);
    const second = await take(request("2", T0 + 60000));

    const manifest = manifestOf(store, second);
    assert.equal(second.mode, "full");
    assert.equal(manifest.cleared_at, new Date(T0 + 1000).toISOString());
    assert.deepEqual(Object.keys(manifest.tiles), ["1_1"]);
  });

  test("rebuilds from Firestore when a tile of the previous snapshot is missing", async () => {
    const { store, take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 5000);
    const first = await take(request("1", T0));
    store.objects.delete(manifestOf(store, first).tiles["0_0"].object);

    setClock(T0 + 60000);
    draw(11, 20, "#0000ff", T0 + 30000);
    const second = await quiet(() => take(request("2", T0 + 60000)));

    assert.equal(second.mode, "full");
    assert.equal(second.count, 2);
  });

  test("a redelivered request rewrites the same objects and keeps the chain", async () => {
    const { store, take, draw, setClock } = setup();
    draw(10, 20, "#ff0000", T0 - 5000);
    const first = await take(request("1", T0));
    setClock(T0 + 60000);
    const second = await take(request("2", T0 + 60000));
    const objects = store.objects.size;
    const again = await take(request("2", T0 + 60000));

    assert.equal(again.name, second.name);
    assert.equal(store.objects.size, objects);
    assert.equal(manifestOf(store, again).previous, first.manifest);
  });
});

describe("invalid requests", () => {
  for (const [name, bad] of Object.entries({
    "another event type": { type: "pixel.processed" },
    "a missing snapshot id": { snapshot_id: undefined },
    "a snapshot id that could change the file path": { snapshot_id: "../../index" },
    "a request time that is not a date": { requested_at: "hier" }
  })) {
    test(`refuses ${name} without storing anything`, async () => {
      const { store, take } = setup();
      await assert.rejects(take({ ...request("1", T0), ...bad }), InvalidRequestError);
      assert.equal(store.objects.size, 0);
    });
  }
});

describe("pixel data from Firestore", () => {
  test("ignores malformed pixel documents", async () => {
    const { store, db, take } = setup();
    db.docs.set("pixels/a", { x: -1, y: 0, color: "#ff0000", updated_at: new Date(T0 - 1) });
    db.docs.set("pixels/b", { x: 1, y: 1, color: "red", updated_at: new Date(T0 - 1) });
    db.docs.set("pixels/c", { x: 2, y: 2, color: "#00ff00", updated_at: new Date(T0 - 1) });
    const result = await take(request("1", T0));
    assert.equal(result.count, 1);
    assert.equal(countPainted(decodeTile(store.objects.get(manifestOf(store, result).tiles["0_0"].object).data)), 1);
  });
});
