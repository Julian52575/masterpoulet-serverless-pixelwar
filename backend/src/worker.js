// Consumes the commands queued by the API; returns the event to push to clients.
function createWorker(db) {
  return async function handle(type, payload) {
    if (type === "pixel.draw") {
      const { pixels, author, at } = payload;
      const updated = await db.$transaction(
        pixels.map(({ x, y, color }) =>
          db.pixel.upsert({
            where: { x_y: { x, y } },
            create: { x, y, color, author, updatedAt: at },
            update: { color, author, updatedAt: at },
          }),
        ),
      );
      return { type: "pixels.updated", payload: updated };
    }
    if (type === "canvas.clear") {
      await db.pixel.deleteMany({});
      return { type: "canvas.cleared", payload: {} };
    }
    return null;
  };
}

module.exports = { createWorker };
