const { createReplier } = require("./reply");
const { validateDraw, readWebDraw } = require("./draw");
const { snowflakeTime } = require("./snowflake");
const { log } = require("./logger");

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const DRAW_PAUSED = "⏸️ Drawing is paused for now, try again later.";
const drawn = ({ x, y, color }, remaining) =>
  `🎨 Pixel (${x}, ${y}) drawn in ${color}. You have ${plural(remaining, "pixel")} left this minute.`;
const rateLimited = (limit, seconds) =>
  `⏳ You reached your limit of ${plural(limit, "pixel")} per minute. Try again in ${seconds} s.`;

function createHandlers({ limits, pixels, discord, now = () => Date.now() }) {
  const reply = createReplier({ discord });

  return {
    draw: async (event) => {
      const checked = validateDraw(event.payload);
      if (!checked.ok) return reply(event, checked.error);

      const { pixel } = checked;
      const drawnAt = snowflakeTime(event.interaction_id) ?? new Date(now());
      const limit = await limits.limitFor(event.user_id);
      const result = await pixels.draw({
        requestId: event.interaction_id ?? event.correlation_id,
        ...pixel,
        author: event.user_id,
        authorName: event.username,
        drawnAt,
        limit
      });

      if (result.status === "paused") return reply(event, DRAW_PAUSED);
      if (result.status === "rate_limited") return reply(event, rateLimited(result.limit, result.retryAfterSeconds));

      await reply(event, drawn(pixel, result.remaining));
    },

    "web.draw": async (event) => {
      const request = readWebDraw(event);
      const limit = await limits.limitFor(request.author);
      const result = await pixels.drawArea({ ...request, limit });

      log.info("web draw applied", {
        correlation_id: event.correlation_id,
        user_id: request.author,
        status: result.status,
        requested: result.requested,
        granted: result.granted
      });
    }
  };
}

module.exports = { createHandlers, DRAW_PAUSED, drawn, rateLimited };
