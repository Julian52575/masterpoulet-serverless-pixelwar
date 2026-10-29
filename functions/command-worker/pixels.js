const { TILE } = require("./grid");
const { STATE_COLLECTION, CANVAS_DOC } = require("./state");

const PIXELS_COLLECTION = "pixels";
const RATE_COLLECTION = "ratelimit";
const WINDOW_MS = 60 * 1000;
const COUNTER_TTL_MS = 60 * 60 * 1000;

const pixelId = (x, y) => `${x}_${y}`;
const tileId = (x, y) => `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;

function createPixelStore({ db, now = () => Date.now() }) {
  const canvas = db.collection(STATE_COLLECTION).doc(CANVAS_DOC);

  async function draw({ x, y, color, author, authorName, drawnAt, limit }) {
    const startedAt = now();
    const window = Math.floor(startedAt / WINDOW_MS);
    const counter = db.collection(RATE_COLLECTION).doc(`${author}_${window}`);
    const pixel = db.collection(PIXELS_COLLECTION).doc(pixelId(x, y));

    return db.runTransaction(async (tx) => {
      const [stateSnap, counterSnap, pixelSnap] = await tx.getAll(canvas, counter, pixel);

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

      const previous = pixelSnap.exists ? pixelSnap.data().updated_at : null;
      const previousMs = previous?.toMillis?.() ?? previous?.getTime?.() ?? null;
      const newer = previousMs === null || drawnAt.getTime() >= previousMs;

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
    });
  }

  return { draw };
}

module.exports = { createPixelStore, pixelId, tileId, PIXELS_COLLECTION, RATE_COLLECTION, WINDOW_MS };
