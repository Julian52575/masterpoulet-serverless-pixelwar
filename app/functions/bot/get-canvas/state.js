const STATE_COLLECTION = "state";
const CANVAS_DOC = "canvas";

function toMillis(value) {
  return value?.toMillis?.() ?? value?.getTime?.() ?? null;
}

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

  async function setCleared(clearedAt, clearedBy) {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(canvas);
      const current = snapshot.exists ? toMillis(snapshot.data().cleared_at) : null;
      if (current !== null && current >= clearedAt.getTime()) return false;
      tx.set(canvas, { cleared_at: clearedAt, cleared_by: clearedBy }, { merge: true });
      return true;
    });
  }

  return { setPaused, isPaused, setCleared };
}

module.exports = { createCanvasState, toMillis, STATE_COLLECTION, CANVAS_DOC };
