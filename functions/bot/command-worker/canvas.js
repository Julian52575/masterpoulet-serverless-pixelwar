const { PIXELS_COLLECTION } = require("./pixels");
const { STATE_COLLECTION, CANVAS_DOC } = require("./state");

function createCanvasReader({ db }) {
  async function visiblePixels() {
    const state = await db.collection(STATE_COLLECTION).doc(CANVAS_DOC).get();
    const clearedAt = state.exists ? state.data().cleared_at : undefined;

    let query = db.collection(PIXELS_COLLECTION).select("x", "y", "color", "updated_at");
    if (clearedAt) query = query.where("updated_at", ">", clearedAt);

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data());
  }

  return { visiblePixels };
}

module.exports = { createCanvasReader };
