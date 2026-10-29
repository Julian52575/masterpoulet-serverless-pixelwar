const { createReplier } = require("./reply");
const { isValidLimit, MIN_RATE_LIMIT, MAX_RATE_LIMIT } = require("./limits");

const PAUSED = "⏸️ Le dessin est en pause : /draw et le site sont bloqués jusqu'à /admin resume.";
const RESUMED = "▶️ Le dessin a repris.";
const SNOWFLAKE = /^\d{1,20}$/;

const limitSet = (userId, limit) =>
  `✅ <@${userId}> peut maintenant dessiner ${limit} pixel${limit > 1 ? "s" : ""} par minute.`;
const INVALID_USER = "❌ Utilisateur invalide.";
const INVALID_LIMIT = `❌ La limite doit être un nombre entier entre ${MIN_RATE_LIMIT} et ${MAX_RATE_LIMIT}.`;

function createHandlers({ state, limits, discord }) {
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
    "admin.ratelimit": async (event) => {
      const { user, limit } = event.payload ?? {};
      if (typeof user !== "string" || !SNOWFLAKE.test(user)) return reply(event, INVALID_USER);
      if (!isValidLimit(limit)) return reply(event, INVALID_LIMIT);

      await limits.setLimit(user, limit, event.user_id);
      await reply(event, limitSet(user, limit));
    }
  };
}

module.exports = { createHandlers, PAUSED, RESUMED, INVALID_USER, INVALID_LIMIT, limitSet };
