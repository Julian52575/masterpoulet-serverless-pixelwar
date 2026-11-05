const { createReplier } = require("./reply");
const { isValidLimit, MIN_RATE_LIMIT, MAX_RATE_LIMIT } = require("./limits");
const { validateDraw } = require("./draw");
const { snowflakeTime } = require("./snowflake");
const { renderCanvas } = require("./render");

const PAUSED = "⏸️ Drawing is paused: /draw and the website are blocked until /admin resume.";
const RESUMED = "▶️ Drawing has resumed.";
const SNOWFLAKE = /^\d{1,20}$/;

const limitSet = (userId, limit) =>
  `✅ <@${userId}> can now draw ${limit} pixel${limit === 1 ? "" : "s"} per minute.`;
const INVALID_USER = "❌ Invalid user.";
const INVALID_LIMIT = `❌ The limit must be a whole number between ${MIN_RATE_LIMIT} and ${MAX_RATE_LIMIT}.`;

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const DRAW_PAUSED = "⏸️ Drawing is paused for now, try again later.";
const drawn = ({ x, y, color }, remaining) =>
  `🎨 Pixel (${x}, ${y}) drawn in ${color}. You have ${plural(remaining, "pixel")} left this minute.`;
const rateLimited = (limit, seconds) =>
  `⏳ You reached your limit of ${plural(limit, "pixel")} per minute. Try again in ${seconds} s.`;
const EMPTY_CANVAS = "🖼️ The canvas is empty for now.";
const canvasImage = ({ count, region, scale }) =>
  `🖼️ Current canvas: ${plural(count, "pixel")}, from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1})` +
  (scale > 1 ? `, image scaled down ${scale} times to fit in Discord.` : ".");
const imageName = (at) => `pixelwar-${at.toISOString().replace(/[:.]/g, "-")}.png`;
const SNAPSHOT_PENDING = "📸 Creating the snapshot, the link will arrive in a few seconds…";
const cleared = (deleted) => `🧹 The canvas was cleared (${plural(deleted, "pixel")} removed).`;

function createHandlers({ state, limits, pixels, events, cleaner, canvas, snapshots, discord, now = () => Date.now() }) {
  const reply = createReplier({ discord });

  return {
    get: async (event) => {
      const image = renderCanvas(await canvas.visiblePixels());
      const content = image.count === 0 ? EMPTY_CANVAS : canvasImage(image);
      await reply(event, content, [{ name: imageName(new Date(now())), data: image.png, contentType: "image/png" }]);
    },

    snapshot: async (event) => {
      await snapshots.request({
        snapshotId: event.interaction_id ?? event.correlation_id,
        requestedAt: snowflakeTime(event.interaction_id) ?? new Date(now()),
        requestedBy: event.user_id,
        applicationId: event.application_id,
        interactionToken: event.interaction_token,
        channelId: event.channel_id,
        correlationId: event.correlation_id
      });
      await reply(event, SNAPSHOT_PENDING);
    },

    "admin.clear": async (event) => {
      const clearedAt = snowflakeTime(event.interaction_id) ?? new Date(now());
      await state.setCleared(clearedAt, event.user_id);
      const deleted = await cleaner.clearBefore(clearedAt);
      await events.canvasCleared({ clearedAt, clearedBy: event.user_id, correlationId: event.correlation_id });
      await reply(event, cleared(deleted));
    },

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

      if (!result.superseded) {
        await events.pixelProcessed({
          ...pixel,
          author: event.user_id,
          authorName: event.username,
          updatedAt: drawnAt,
          correlationId: event.correlation_id
        });
      }
      await reply(event, drawn(pixel, result.remaining));
    },

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

module.exports = {
  createHandlers,
  PAUSED,
  RESUMED,
  INVALID_USER,
  INVALID_LIMIT,
  DRAW_PAUSED,
  EMPTY_CANVAS,
  SNAPSHOT_PENDING,
  canvasImage,
  imageName,
  cleared,
  limitSet,
  drawn,
  rateLimited
};
