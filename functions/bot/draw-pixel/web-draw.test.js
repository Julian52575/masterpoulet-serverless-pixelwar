const { test, describe, mock } = require("node:test");
const assert = require("node:assert/strict");
const { readWebDraw, cellsOf, InvalidCommandError, MAX_AREA } = require("./draw");
const { createPixelStore, PROCESSED_COLLECTION } = require("./pixels");
const { createPixelEvents } = require("./events");
const { createHandlers } = require("./handlers");
const { createWorker } = require("./worker");
const { fakeFirestore } = require("./fake-firestore");

const MINUTE_START = Date.UTC(2026, 10, 6, 15, 0, 0);
const DRAWN_AT = "2026-11-06T15:00:10.000Z";

const webDraw = (extra = {}) => ({
  type: "web.draw",
  source: "web",
  user_id: "111",
  username: "Alice",
  rect: { x0: 10, y0: 20, x1: 12, y1: 22 },
  color: "#E50000",
  request_id: "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10",
  requested_at: DRAWN_AT,
  correlation_id: "corr-web",
  ...extra
});

function silenced(fn) {
  const out = mock.method(console, "log", () => {});
  return Promise.resolve().then(fn).finally(() => out.mock.restore());
}

describe("readWebDraw", () => {
  test("turns the rectangle into pixels, row by row", () => {
    const request = readWebDraw(webDraw());
    assert.deepEqual(request, {
      requestId: "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10",
      author: "111",
      authorName: "Alice",
      color: "#e50000",
      drawnAt: new Date(DRAWN_AT),
      cells: [{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 10, y: 21 }, { x: 11, y: 21 }]
    });
  });

  test("treats a single pixel as a 1x1 rectangle and accepts palette names", () => {
    const request = readWebDraw(webDraw({ rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, color: "blue" }));
    assert.deepEqual(request.cells, [{ x: 0, y: 0 }]);
    assert.equal(request.color, "#0083c7");
  });

  test("accepts a rectangle touching the far edges of the grid", () => {
    const request = readWebDraw(webDraw({ rect: { x0: 9998, y0: 9999, x1: 10000, y1: 10000 } }));
    assert.deepEqual(request.cells, [{ x: 9998, y: 9999 }, { x: 9999, y: 9999 }]);
  });

  test("allows a full 16x16 brush and nothing bigger", () => {
    assert.equal(MAX_AREA, 256);
    assert.equal(readWebDraw(webDraw({ rect: { x0: 0, y0: 0, x1: 16, y1: 16 } })).cells.length, 256);
    assert.throws(() => readWebDraw(webDraw({ rect: { x0: 0, y0: 0, x1: 17, y1: 16 } })), InvalidCommandError);
  });

  for (const [name, rect] of [
    ["outside the grid", { x0: 9999, y0: 0, x1: 10001, y1: 1 }],
    ["negative", { x0: -1, y0: 0, x1: 1, y1: 1 }],
    ["empty", { x0: 5, y0: 5, x1: 5, y1: 6 }],
    ["inverted", { x0: 6, y0: 5, x1: 5, y1: 6 }],
    ["not whole numbers", { x0: 0.5, y0: 0, x1: 1, y1: 1 }],
    ["missing", undefined]
  ]) {
    test(`rejects a rectangle that is ${name}`, () => {
      assert.throws(() => readWebDraw(webDraw({ rect })), InvalidCommandError);
    });
  }

  for (const [name, extra] of [
    ["does not come from the web", { source: "discord" }],
    ["has no valid Discord user id", { user_id: "alice" }],
    ["has no request id", { request_id: undefined }],
    ["has an unsafe request id", { request_id: "../processed/x" }],
    ["has an invalid color", { color: "crimson" }],
    ["has no valid time", { requested_at: "yesterday" }],
    ["has a numeric time", { requested_at: 1762441210000 }]
  ]) {
    test(`rejects a command that ${name}`, () => {
      assert.throws(() => readWebDraw(webDraw(extra)), InvalidCommandError);
    });
  }

  test("lists no pixel twice", () => {
    const cells = cellsOf({ x0: 0, y0: 0, x1: 16, y1: 16 });
    assert.equal(new Set(cells.map(({ x, y }) => `${x}_${y}`)).size, 256);
  });
});

describe("drawArea", () => {
  function make({ at = MINUTE_START + 15000, chunkSize } = {}) {
    const db = fakeFirestore();
    const store = createPixelStore({ db, now: () => at, ...(chunkSize ? { chunkSize } : {}) });
    return { db, store };
  }

  const area = (extra = {}) => ({ ...readWebDraw(webDraw()), limit: 20, ...extra });
  const receipts = (db) => [...db.docs.keys()].filter((key) => key.startsWith(`${PROCESSED_COLLECTION}/`));

  test("writes every pixel with its color, author, tile and time", async () => {
    const { db, store } = make();
    const result = await store.drawArea(area());

    assert.deepEqual(result, {
      status: "drawn",
      requested: 4,
      granted: 4,
      chunks: [[{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 10, y: 21 }, { x: 11, y: 21 }]]
    });
    assert.deepEqual(db.docs.get("pixels/11_21"), {
      x: 11,
      y: 21,
      tile: "0_0",
      color: "#e50000",
      author: "111",
      author_name: "Alice",
      updated_at: new Date(DRAWN_AT)
    });
  });

  test("counts one draw per pixel against the user's limit", async () => {
    const { db, store } = make();
    await store.drawArea(area());
    assert.equal(db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`).count, 4);
  });

  test("shares the per-minute counter with /draw", async () => {
    const { db, store } = make();
    await store.draw({ requestId: "1300000000000000000", x: 1, y: 1, color: "#000000", author: "111", drawnAt: new Date(DRAWN_AT), limit: 5 });
    const result = await store.drawArea(area({ limit: 5 }));

    assert.equal(result.granted, 4);
    assert.equal(db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`).count, 5);
  });

  test("only draws the first pixels when the quota is smaller than the brush", async () => {
    const { db, store } = make();
    const result = await store.drawArea(area({ limit: 3 }));

    assert.equal(result.status, "drawn");
    assert.equal(result.granted, 3);
    assert.deepEqual(result.chunks, [[{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 10, y: 21 }]]);
    assert.equal(db.docs.has("pixels/11_21"), false);
  });

  test("draws nothing once the quota is used up", async () => {
    const { db, store } = make();
    await store.drawArea(area({ limit: 4 }));
    const result = await store.drawArea(area({ limit: 4, requestId: "second-request" }));

    assert.deepEqual(result, { status: "rate_limited", requested: 4, granted: 0, chunks: [] });
    assert.equal(db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`).count, 4);
  });

  test("draws nothing and counts nothing while the canvas is paused", async () => {
    const { db, store } = make();
    db.docs.set("state/canvas", { paused: true });
    const result = await store.drawArea(area());

    assert.deepEqual(result, { status: "paused", requested: 4, granted: 0, chunks: [] });
    assert.equal([...db.docs.keys()].some((key) => key.startsWith("pixels/") || key.startsWith("ratelimit/")), false);
  });

  test("keeps a newer pixel but still counts the draw", async () => {
    const { db, store } = make();
    const newer = { x: 10, y: 20, color: "#000000", author: "222", updated_at: new Date("2026-11-06T15:00:30.000Z") };
    db.docs.set("pixels/10_20", newer);
    const result = await store.drawArea(area());

    assert.equal(result.granted, 4);
    assert.deepEqual(result.chunks, [[{ x: 11, y: 20 }, { x: 10, y: 21 }, { x: 11, y: 21 }]]);
    assert.deepEqual(db.docs.get("pixels/10_20"), newer);
  });

  test("does not draw over a clear that happened after the brush stroke", async () => {
    const { db, store } = make();
    db.docs.set("state/canvas", { cleared_at: new Date("2026-11-06T15:00:20.000Z") });
    const result = await store.drawArea(area());

    assert.equal(result.granted, 4);
    assert.deepEqual(result.chunks, []);
  });

  test("splits a large brush into several transactions, each with its own receipt", async () => {
    const { db, store } = make({ chunkSize: 3 });
    const result = await store.drawArea(area({ cells: cellsOf({ x0: 0, y0: 0, x1: 4, y1: 2 }) }));

    assert.equal(db.transactions, 3);
    assert.deepEqual(result.chunks.map((chunk) => chunk.length), [3, 3, 2]);
    assert.deepEqual(receipts(db).sort(), [0, 1, 2].map((i) => `processed/6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10_${i}`));
  });

  test("stops after the chunk where the quota runs out", async () => {
    const { db, store } = make({ chunkSize: 3 });
    const result = await store.drawArea(area({ cells: cellsOf({ x0: 0, y0: 0, x1: 4, y1: 2 }), limit: 4 }));

    assert.equal(result.granted, 4);
    assert.equal(db.transactions, 2);
    assert.deepEqual(result.chunks, [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], [{ x: 3, y: 0 }]]);
  });

  test("never counts a redelivered stroke twice, and returns the same pixels", async () => {
    const { db, store } = make({ chunkSize: 3 });
    const request = area({ cells: cellsOf({ x0: 0, y0: 0, x1: 4, y1: 2 }) });
    const first = await store.drawArea(request);
    const again = await store.drawArea(request);

    assert.deepEqual(again, first);
    assert.equal(db.docs.get(`ratelimit/111_${Math.floor(MINUTE_START / 60000)}`).count, 8);
  });

  test("does not announce again a pixel overwritten since the first delivery", async () => {
    const { db, store } = make();
    await store.drawArea(area());
    db.docs.set("pixels/10_20", { x: 10, y: 20, color: "#000000", author: "222", updated_at: new Date("2026-11-06T15:00:30.000Z") });
    const again = await store.drawArea(area());

    assert.deepEqual(again.chunks, [[{ x: 11, y: 20 }, { x: 10, y: 21 }, { x: 11, y: 21 }]]);
  });
});

describe("web events", () => {
  function fakeTopic() {
    const sent = [];
    return { sent, publishMessage: async (message) => { sent.push(message); return "msg-1"; } };
  }

  test("pixels.processed lists the changed pixels and their tiles once", async () => {
    const topic = fakeTopic();
    await createPixelEvents({ topic }).pixelsProcessed({
      cells: [{ x: 255, y: 0 }, { x: 256, y: 0 }, { x: 257, y: 0 }],
      color: "#e50000",
      author: "111",
      authorName: "Alice",
      updatedAt: new Date(DRAWN_AT),
      correlationId: "corr-web"
    });

    const pixel = (x) => ({ x, y: 0, color: "#e50000", author: "111", author_name: "Alice", updated_at: DRAWN_AT });
    assert.deepEqual(topic.sent[0], {
      json: { type: "pixels.processed", pixels: [pixel(255), pixel(256), pixel(257)], tiles: ["0_0", "1_0"], correlation_id: "corr-web" },
      attributes: { type: "pixels.processed", correlation_id: "corr-web" }
    });
  });

  test("announces a pause and a resume with who did it and when", async () => {
    const topic = fakeTopic();
    const events = createPixelEvents({ topic });
    await events.pauseChanged({ paused: true, by: "999", at: new Date(DRAWN_AT), correlationId: "corr-1" });
    await events.pauseChanged({ paused: false, by: "999", at: new Date(DRAWN_AT) });

    assert.deepEqual(topic.sent.map((m) => m.json), [
      { type: "canvas.paused", by: "999", at: DRAWN_AT, correlation_id: "corr-1" },
      { type: "canvas.resumed", by: "999", at: DRAWN_AT, correlation_id: null }
    ]);
    assert.deepEqual(topic.sent.map((m) => m.attributes.type), ["canvas.paused", "canvas.resumed"]);
  });
});

describe("web.draw handler", () => {
  function make({ result } = {}) {
    const calls = [];
    const limits = { limitFor: async (user) => { calls.push({ limitFor: user }); return 20; } };
    const pixels = {
      drawArea: async (request) => {
        calls.push({ drawArea: { cells: request.cells.length, limit: request.limit, requestId: request.requestId } });
        return result ?? { status: "drawn", requested: 4, granted: 4, chunks: [[{ x: 10, y: 20 }], [{ x: 11, y: 20 }]] };
      }
    };
    const events = { pixelsProcessed: async (event) => calls.push({ publish: event.cells, author: event.author, correlationId: event.correlationId }) };
    const discord = { editOriginal: async () => calls.push("discord") };
    return { handle: createHandlers({ limits, pixels, events, discord })["web.draw"], calls };
  }

  test("reads the user's limit, draws, then announces each written chunk", async () => {
    const { handle, calls } = make();
    await silenced(() => handle(webDraw()));

    assert.deepEqual(calls, [
      { limitFor: "111" },
      { drawArea: { cells: 4, limit: 20, requestId: "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10" } },
      { publish: [{ x: 10, y: 20 }], author: "111", correlationId: "corr-web" },
      { publish: [{ x: 11, y: 20 }], author: "111", correlationId: "corr-web" }
    ]);
  });

  test("announces nothing when nothing was written, and never calls Discord", async () => {
    const { handle, calls } = make({ result: { status: "paused", requested: 4, granted: 0, chunks: [] } });
    await silenced(() => handle(webDraw()));

    assert.deepEqual(calls, [{ limitFor: "111" }, { drawArea: { cells: 4, limit: 20, requestId: "6f1c0d0e-4a51-4d2b-9a43-3c1f7d4a2b10" } }]);
  });

  test("refuses an invalid command before touching Firestore", async () => {
    const { handle, calls } = make();
    await assert.rejects(handle(webDraw({ color: "nope" })), InvalidCommandError);
    assert.deepEqual(calls, []);
  });
});

describe("web.draw in the worker", () => {
  const push = (event) => Buffer.from(JSON.stringify({
    message: { data: Buffer.from(JSON.stringify(event)).toString("base64"), messageId: "msg-1" }
  }));

  function make(handler) {
    return createWorker({ handlers: { "web.draw": handler } });
  }

  test("lets a normal user draw from the web", async () => {
    let ran = false;
    const handle = make(async () => { ran = true; });
    const { statusCode } = await silenced(() => handle(push(webDraw())));

    assert.equal(statusCode, 204);
    assert.equal(ran, true);
  });

  test("sends an invalid command to the dead-letter topic instead of retrying it", async () => {
    const handle = make(async () => { throw new InvalidCommandError("invalid color"); });
    const { statusCode } = await silenced(() => handle(push(webDraw())));
    assert.equal(statusCode, 400);
  });

  test("still retries when the failure is temporary", async () => {
    const handle = make(async () => { throw new Error("firestore unavailable"); });
    const { statusCode } = await silenced(() => handle(push(webDraw())));
    assert.equal(statusCode, 500);
  });
});
