const DISCORD_EPOCH = 1420070400000n;
const SNOWFLAKE = /^\d{1,20}$/;

function snowflakeTime(id) {
  if (typeof id !== "string" || !SNOWFLAKE.test(id)) return null;
  const ms = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  return Number.isSafeInteger(ms) ? new Date(ms) : null;
}

module.exports = { snowflakeTime };
