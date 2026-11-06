const { TILE } = require("./grid");
const { STATE_COLLECTION, CANVAS_DOC, toMillis } = require("./state");

const PIXELS_COLLECTION = "pixels";
const RATE_COLLECTION = "ratelimit";
const PROCESSED_COLLECTION = "processed";
const WINDOW_MS = 60 * 1000;
const COUNTER_TTL_MS = 60 * 60 * 1000;
const PROCESSED_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CHUNK_SIZE = 400;

const pixelId = (x, y) => `${x}_${y}`;
const tileId = (x, y) => `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;

function isNewerThan(pixelSnap, drawnAt) {
  if (!pixelSnap.exists) return false;
  const storedMs = toMillis(pixelSnap.data().updated_at);
  return storedMs !== null && storedMs > drawnAt.getTime();
}

function isErasedBy(stateSnap, drawnAt) {
  if (!stateSnap.exists) return false;
  const clearedMs = toMillis(stateSnap.data().cleared_at);
  return clearedMs !== null && drawnAt.getTime() <= clearedMs;
}

function createPixelStore({ db, now = () => Date.now(), chunkSize = CHUNK_SIZE }) {
  const canvas = db.collection(STATE_COLLECTION).doc(CANVAS_DOC);

  async function draw({ requestId, x, y, color, author, authorName, drawnAt, limit }) {
    const startedAt = now();
    const window = Math.floor(startedAt / WINDOW_MS);
    const counter = db.collection(RATE_COLLECTION).doc(`${author}_${window}`);
    const pixel = db.collection(PIXELS_COLLECTION).doc(pixelId(x, y));
    const receipt = typeof requestId === "string" && REQUEST_ID.test(requestId)
      ? db.collection(PROCESSED_COLLECTION).doc(requestId)
      : null;

    return db.runTransaction(async (tx) => {
      const refs = receipt ? [canvas, counter, pixel, receipt] : [canvas, counter, pixel];
      const [stateSnap, counterSnap, pixelSnap, receiptSnap] = await tx.getAll(...refs);

      if (receiptSnap?.exists) {
        const stored = receiptSnap.data().result;
        const overtaken = stored.status === "drawn" &&
          (isNewerThan(pixelSnap, drawnAt) || isErasedBy(stateSnap, drawnAt));
        return { ...stored, superseded: stored.superseded || overtaken, replayed: true };
      }

      const result = apply(tx, stateSnap, counterSnap, pixelSnap);
      if (receipt) {
        tx.set(receipt, {
          command: "draw",
          result,
          processed_at: new Date(startedAt),
          expires_at: new Date(startedAt + PROCESSED_TTL_MS)
        });
      }
      return result;
    });

    function apply(tx, stateSnap, counterSnap, pixelSnap) {
      if (stateSnap.exists && stateSnap.data().paused === true) {
        return { status: "paused" };
      }

      const used = counterSnap.exists ? counterSnap.data().count : 0;
      if (used >= limit) {
        return {
          status: "rate_limited",
          limit,
          retryAfterSeconds: Math.ceil(((window + 1) * WINDOW_MS - startedAt) / 1000)
        };
      }

      tx.set(counter, {
        user: author,
        count: used + 1,
        window_start: new Date(window * WINDOW_MS),
        expires_at: new Date((window + 1) * WINDOW_MS + COUNTER_TTL_MS)
      });

      const newer = !isNewerThan(pixelSnap, drawnAt) && !isErasedBy(stateSnap, drawnAt);

      if (newer) {
        tx.set(pixel, {
          x,
          y,
          tile: tileId(x, y),
          color,
          author,
          author_name: authorName ?? null,
          updated_at: drawnAt
        });
      }

      return { status: "drawn", superseded: !newer, limit, remaining: limit - used - 1 };
    }
  }

  async function drawArea({ requestId, cells, color, author, authorName, drawnAt, limit }) {
    const startedAt = now();
    const window = Math.floor(startedAt / WINDOW_MS);
    const counter = db.collection(RATE_COLLECTION).doc(`${author}_${window}`);
    const chunks = [];
    let granted = 0;
    let last = { status: "drawn" };

    for (let start = 0; start < cells.length; start += chunkSize) {
      const chunk = cells.slice(start, start + chunkSize);
      last = await drawChunk(`${requestId}_${start / chunkSize}`, chunk);
      granted += last.granted;
      if (last.written.length > 0) chunks.push(last.written);
      if (last.status !== "drawn" || last.granted < chunk.length) break;
    }

    return {
      status: granted > 0 ? "drawn" : last.status,
      requested: cells.length,
      granted,
      chunks
    };

    function isFromThisDraw(pixelSnap) {
      if (!pixelSnap.exists) return false;
      const stored = pixelSnap.data();
      return stored.author === author && stored.color === color && toMillis(stored.updated_at) === drawnAt.getTime();
    }

    function drawChunk(receiptId, chunk) {
      const receipt = db.collection(PROCESSED_COLLECTION).doc(receiptId);
      const refs = chunk.map(({ x, y }) => db.collection(PIXELS_COLLECTION).doc(pixelId(x, y)));

      return db.runTransaction(async (tx) => {
        const [stateSnap, counterSnap, receiptSnap, ...pixelSnaps] = await tx.getAll(canvas, counter, receipt, ...refs);

        if (receiptSnap.exists) {
          const stored = receiptSnap.data().result;
          const written = chunk.filter((cell, i) => isFromThisDraw(pixelSnaps[i]));
          return { ...stored, written, replayed: true };
        }

        const result = applyChunk(tx, stateSnap, counterSnap, pixelSnaps, chunk, refs);
        const { written, ...stored } = result;
        tx.set(receipt, {
          command: "web.draw",
          result: stored,
          processed_at: new Date(startedAt),
          expires_at: new Date(startedAt + PROCESSED_TTL_MS)
        });
        return result;
      });
    }

    function applyChunk(tx, stateSnap, counterSnap, pixelSnaps, chunk, refs) {
      if (stateSnap.exists && stateSnap.data().paused === true) {
        return { status: "paused", granted: 0, written: [] };
      }

      const used = counterSnap.exists ? counterSnap.data().count : 0;
      if (used >= limit) {
        return {
          status: "rate_limited",
          granted: 0,
          retryAfterSeconds: Math.ceil(((window + 1) * WINDOW_MS - startedAt) / 1000),
          written: []
        };
      }

      const allowed = Math.min(chunk.length, limit - used);
      tx.set(counter, {
        user: author,
        count: used + allowed,
        window_start: new Date(window * WINDOW_MS),
        expires_at: new Date((window + 1) * WINDOW_MS + COUNTER_TTL_MS)
      });

      const written = [];
      for (let i = 0; i < allowed; i++) {
        if (isNewerThan(pixelSnaps[i], drawnAt) || isErasedBy(stateSnap, drawnAt)) continue;
        const { x, y } = chunk[i];
        tx.set(refs[i], {
          x,
          y,
          tile: tileId(x, y),
          color,
          author,
          author_name: authorName ?? null,
          updated_at: drawnAt
        });
        written.push({ x, y });
      }

      return { status: "drawn", granted: allowed, written };
    }
  }

  return { draw, drawArea };
}

module.exports = {
  createPixelStore,
  pixelId,
  tileId,
  PIXELS_COLLECTION,
  RATE_COLLECTION,
  PROCESSED_COLLECTION,
  WINDOW_MS,
  CHUNK_SIZE
};
