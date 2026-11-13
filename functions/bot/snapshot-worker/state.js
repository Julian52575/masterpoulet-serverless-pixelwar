const STATE_COLLECTION = "state";
const CANVAS_DOC = "canvas";
const PIXELS_COLLECTION = "pixels";
const FIELDS = ["x", "y", "color", "updated_at"];

function toMillis(value) {
  return value?.toMillis?.() ?? value?.getTime?.() ?? null;
}

function createCanvasReader({ db }) {
  const pixels = () => db.collection(PIXELS_COLLECTION).select(...FIELDS);

  async function clearedAt() {
    const state = await db.collection(STATE_COLLECTION).doc(CANVAS_DOC).get();
    const value = state.exists ? toMillis(state.data().cleared_at) : null;
    return value === null ? null : new Date(value);
  }

  async function visiblePixels(cleared) {
    const query = cleared ? pixels().where("updated_at", ">", cleared) : pixels();
    return (await query.get()).docs.map((doc) => doc.data());
  }

  async function pixelsWrittenSince(since) {
    return (await pixels().where("written_at", ">", since).get()).docs.map((doc) => doc.data());
  }

  return { clearedAt, visiblePixels, pixelsWrittenSince };
}

module.exports = { createCanvasReader, toMillis, STATE_COLLECTION, CANVAS_DOC, PIXELS_COLLECTION };
