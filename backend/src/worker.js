const { Prisma } = require("@prisma/client");
const { SIZE, MAX_IMAGE } = require("./grid");

// Above this many pixels a stroke is announced as a rectangle to refetch, not as a pixel list,
// keeping broker messages far below RabbitMQ's size limit.
const MAX_EVENT_PIXELS = 4096;
const { renderGrid } = require("./render");

// Consumes the commands queued by the API; returns the event to broadcast to clients.
function createWorker({ db, store, admins = [] }) {
  const draw = async ({ rect, count, color, author, at, minute }) => {
    // Pause may have started after the API accepted the draw.
    if (await store.isPaused()) {
      await store.refund(author, count, minute);
      return null;
    }
    const height = rect.y1 - rect.y0;
    // Cells are generated in SQL, column by column, and cut at `count` when the quota truncated the
    // stroke. The WHERE keeps the newest write when draws race on a pixel.
    const upsert = Prisma.sql`
      INSERT INTO pixels (x, y, color, author, updated_at)
      SELECT ${rect.x0}::int + i / ${height}::int, ${rect.y0}::int + i % ${height}::int,
             ${color}, ${author}, ${at}::timestamp(3)
      FROM generate_series(0, ${count}::int - 1) AS i
      ON CONFLICT (x, y) DO UPDATE SET
        color = EXCLUDED.color, author = EXCLUDED.author, updated_at = EXCLUDED.updated_at
      WHERE pixels.updated_at <= EXCLUDED.updated_at`;
    try {
      if (count > MAX_EVENT_PIXELS) {
        await db.$executeRaw`${upsert}`;
        return { type: "tiles.invalidated", payload: rect };
      }
      const rows = await db.$queryRaw`${upsert} RETURNING x, y, color, author, updated_at AS "updatedAt"`;
      return rows.length ? { type: "pixels.updated", payload: rows } : null;
    } catch (err) {
      await store.refund(author, count, minute).catch(() => {});
      throw err;
    }
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
