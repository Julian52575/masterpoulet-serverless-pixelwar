const { SIZE, MAX_IMAGE } = require("./grid");
const { renderGrid } = require("./render");

// Consumes the commands queued by the API; returns the event to broadcast to clients.
function createWorker({ db, store, admins = [] }) {
  const draw = async ({ pixels, author, at, minute }) => {
    // Pause may have started after the API accepted the draw.
    if (await store.isPaused()) {
      await store.refund(author, pixels.length, minute);
      return null;
    }
    let rows;
    try {
      // One statement per stroke; the WHERE keeps the newest write when draws race on a pixel.
      rows = await db.$queryRaw`
        INSERT INTO pixels (x, y, color, author, updated_at)
        SELECT t.x, t.y, t.color, ${author}, ${at}::timestamp(3)
        FROM unnest(${pixels.map((p) => p.x)}::int[], ${pixels.map((p) => p.y)}::int[],
                    ${pixels.map((p) => p.color)}::text[]) AS t(x, y, color)
        ON CONFLICT (x, y) DO UPDATE SET
          color = EXCLUDED.color, author = EXCLUDED.author, updated_at = EXCLUDED.updated_at
        WHERE pixels.updated_at <= EXCLUDED.updated_at
        RETURNING x, y, color, author, updated_at AS "updatedAt"`;
    } catch (err) {
      await store.refund(author, pixels.length, minute).catch(() => {});
      throw err;
    }
    return rows.length ? { type: "pixels.updated", payload: rows } : null;
  };

  const snapshot = async ({ at }) => {
    const name = `snapshot-${at.replace(/[:.]/g, "-")}.png`;
    const png = await renderGrid(db, { size: SIZE, max: MAX_IMAGE });
    await db.snapshot.create({ data: { name, png } });
    return { type: "snapshot.ready", payload: { name, url: `/api/snapshots/${name}` } };
  };

  const adminCommands = {
    "admin.pause": async () => {
      await store.setPaused(true);
      return { type: "canvas.paused", payload: {} };
    },
    "admin.resume": async () => {
      await store.setPaused(false);
      return { type: "canvas.resumed", payload: {} };
    },
    "admin.clear": async () => {
      await db.pixel.deleteMany({});
      return { type: "canvas.cleared", payload: {} };
    },
    "admin.ratelimit": async ({ user, limit }) => {
      await store.setLimit(user, limit);
      return null;
    },
  };

  return async function handle(type, payload) {
    if (type === "pixel.draw") return draw(payload);
    if (type === "snapshot.requested") return snapshot(payload);
    const command = adminCommands[type];
    if (!command) return null;
    // Checked again here: the queue is not a trust boundary.
    if (!admins.includes(payload.by)) {
      console.warn(`backend: refused ${type} from non-admin ${payload.by}`);
      return null;
    }
    return command(payload);
  };
}

module.exports = { createWorker };
