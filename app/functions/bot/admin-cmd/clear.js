const { PIXELS_COLLECTION } = require("./pixels");

const PAGE_SIZE = 400;

function createCanvasCleaner({ db, pageSize = PAGE_SIZE }) {
  async function clearBefore(clearedAt) {
    const old = db
      .collection(PIXELS_COLLECTION)
      .where("updated_at", "<=", clearedAt)
      .select()
      .limit(pageSize);

    let deleted = 0;
    for (;;) {
      const page = await old.get();
      if (page.empty) return deleted;

      const batch = db.batch();
      for (const doc of page.docs) batch.delete(doc.ref);
      await batch.commit();
      deleted += page.size;

      if (page.size < pageSize) return deleted;
    }
  }

  return { clearBefore };
}

module.exports = { createCanvasCleaner, PAGE_SIZE };
