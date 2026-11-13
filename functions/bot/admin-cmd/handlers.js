const { createReplier } = require("./reply");
const { isValidLimit, MIN_RATE_LIMIT, MAX_RATE_LIMIT } = require("./limits");
const { snowflakeTime } = require("./snowflake");

const PAUSED = "⏸️ Drawing is paused: /draw and the website are blocked until /admin resume.";
const RESUMED = "▶️ Drawing has resumed.";
const SNOWFLAKE = /^\d{1,20}$/;

const limitSet = (userId, limit) =>
  `✅ <@${userId}> can now draw ${limit} pixel${limit === 1 ? "" : "s"} per minute.`;
const INVALID_USER = "❌ Invalid user.";
const INVALID_LIMIT = `❌ The limit must be a whole number between ${MIN_RATE_LIMIT} and ${MAX_RATE_LIMIT}.`;

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const cleared = (deleted) => `🧹 The canvas was cleared (${plural(deleted, "pixel")} removed).`;

function createHandlers({ state, limits, cleaner, discord, now = () => Date.now() }) {
  const reply = createReplier({ discord });

  return {
    "admin.pause": async (event) => {
      await state.setPaused(true, event.user_id);
      await reply(event, PAUSED);
    },

    "admin.resume": async (event) => {
      await state.setPaused(false, event.user_id);
      await reply(event, RESUMED);
    },

    "admin.clear": async (event) => {
      const clearedAt = snowflakeTime(event.interaction_id) ?? new Date(now());
      await state.setCleared(clearedAt, event.user_id);
      const deleted = await cleaner.clearBefore(clearedAt);
      await reply(event, cleared(deleted));
    },

    "admin.ratelimit": async (event) => {
      const { user, limit } = event.payload ?? {};
      if (typeof user !== "string" || !SNOWFLAKE.test(user)) return reply(event, INVALID_USER);
      if (!isValidLimit(limit)) return reply(event, INVALID_LIMIT);

      await limits.setLimit(user, limit, event.user_id);
      await reply(event, limitSet(user, limit));
    }
  };
}

module.exports = { createHandlers, PAUSED, RESUMED, INVALID_USER, INVALID_LIMIT, cleared, limitSet };
