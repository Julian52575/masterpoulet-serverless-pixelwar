// Pause flag, per-user limits and rate windows live in the database so every instance agrees.
function createStore(db, { defaultLimit = 20, now = Date.now } = {}) {
  const isPaused = async () => {
    const row = await db.setting.findUnique({ where: { key: "paused" } });
    return row?.value === "true";
  };

  const setPaused = async (paused) => {
    const value = String(paused);
    await db.setting.upsert({
      where: { key: "paused" },
      create: { key: "paused", value },
      update: { value },
    });
  };

  const setLimit = async (userId, limit) => {
    await db.rateLimit.upsert({ where: { userId }, create: { userId, limit }, update: { limit } });
  };

  const refund = async (userId, n, minute) => {
    if (minute === undefined || n <= 0) return;
    await db.$executeRaw`
      UPDATE rate_windows SET count = GREATEST(0, count - ${n})
      WHERE user_id = ${userId} AND minute = ${minute}`;
  };

  // Grants up to `cost` pixels. The increment is atomic, so concurrent requests cannot overspend;
  // the part that did not fit is handed back.
  const take = async (userId, cost) => {
    const override = await db.rateLimit.findUnique({ where: { userId } });
    if (!override && defaultLimit === 0) return { granted: cost };
    const limit = override?.limit ?? defaultLimit;
    const minute = Math.floor(now() / 60000);
    const [{ count }] = await db.$queryRaw`
      INSERT INTO rate_windows (user_id, minute, count) VALUES (${userId}, ${minute}, ${cost})
      ON CONFLICT (user_id) DO UPDATE SET
        count = CASE WHEN rate_windows.minute = EXCLUDED.minute
                     THEN rate_windows.count + EXCLUDED.count ELSE EXCLUDED.count END,
        minute = EXCLUDED.minute
      RETURNING count`;
    const granted = Math.max(0, Math.min(cost, limit - (count - cost)));
    await refund(userId, cost - granted, minute);
    return { granted, minute };
  };

  return { isPaused, setPaused, setLimit, take, refund };
}

module.exports = { createStore };
