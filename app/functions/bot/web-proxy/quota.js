const { STATE_COLLECTION, CANVAS_DOC } = require("./state");
const { createRateLimits } = require("./limits");

const RATE_COLLECTION = "ratelimit";
const WINDOW_MS = 60 * 1000;

function createQuota({ db, now = () => Date.now() }) {
  const canvas = db.collection(STATE_COLLECTION).doc(CANVAS_DOC);
  const limits = createRateLimits({ db });

  async function check(userId, area) {
    const at = now();
    const window = Math.floor(at / WINDOW_MS);
    const counter = db.collection(RATE_COLLECTION).doc(`${userId}_${window}`);
    const [stateSnap, counterSnap, limit] = await Promise.all([canvas.get(), counter.get(), limits.limitFor(userId)]);

    if (stateSnap.exists && stateSnap.data().paused === true) return { status: "paused" };

    const used = counterSnap.exists ? counterSnap.data().count : 0;
    const left = limit - used;
    if (left <= 0) {
      return {
        status: "rate_limited",
        limit,
        retryAfterSeconds: Math.ceil(((window + 1) * WINDOW_MS - at) / 1000)
      };
    }
    return { status: "ok", accepted: Math.min(area, left) };
  }

  return { check };
}

module.exports = { createQuota, RATE_COLLECTION, WINDOW_MS };
