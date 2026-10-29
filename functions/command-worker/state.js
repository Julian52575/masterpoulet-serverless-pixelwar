const STATE_COLLECTION = "state";
const CANVAS_DOC = "canvas";

function createCanvasState({ db }) {
  const canvas = db.collection(STATE_COLLECTION).doc(CANVAS_DOC);

  async function setPaused(paused, updatedBy) {
    await canvas.set(
      { paused, updated_by: updatedBy, updated_at: new Date() },
      { merge: true }
    );
  }

  async function isPaused() {
    const snapshot = await canvas.get();
    return snapshot.exists && snapshot.data().paused === true;
  }

  return { setPaused, isPaused };
}

module.exports = { createCanvasState, STATE_COLLECTION, CANVAS_DOC };
