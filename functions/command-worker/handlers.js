const { createReplier } = require("./reply");
const { isValidLimit, MIN_RATE_LIMIT, MAX_RATE_LIMIT } = require("./limits");
const { validateDraw } = require("./draw");
const { snowflakeTime } = require("./snowflake");
const { renderCanvas } = require("./render");

const PAUSED = "⏸️ Le dessin est en pause : /draw et le site sont bloqués jusqu'à /admin resume.";
const RESUMED = "▶️ Le dessin a repris.";
const SNOWFLAKE = /^\d{1,20}$/;

const limitSet = (userId, limit) =>
  `✅ <@${userId}> peut maintenant dessiner ${limit} pixel${limit > 1 ? "s" : ""} par minute.`;
const INVALID_USER = "❌ Utilisateur invalide.";
const INVALID_LIMIT = `❌ La limite doit être un nombre entier entre ${MIN_RATE_LIMIT} et ${MAX_RATE_LIMIT}.`;

const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;
const DRAW_PAUSED = "⏸️ Le dessin est en pause pour le moment, réessaie plus tard.";
const drawn = ({ x, y, color }, remaining) =>
  `🎨 Pixel (${x}, ${y}) dessiné en ${color}. Il te reste ${plural(remaining, "pixel")} cette minute.`;
const rateLimited = (limit, seconds) =>
  `⏳ Tu as atteint ta limite de ${plural(limit, "pixel")} par minute. Réessaie dans ${seconds} s.`;
const EMPTY_CANVAS = "🖼️ La grille est vide pour l'instant.";
const canvasImage = ({ count, region, scale }) =>
  `🖼️ La grille actuelle : ${plural(count, "pixel")}, de (${region.x0}, ${region.y0}) à (${region.x1}, ${region.y1})` +
  (scale > 1 ? `, image réduite ${scale} fois pour tenir dans Discord.` : ".");
const imageName = (at) => `pixelwar-${at.toISOString().replace(/[:.]/g, "-")}.png`;
const cleared = (deleted) => `🧹 La grille a été effacée (${plural(deleted, "pixel")} supprimé${deleted > 1 ? "s" : ""}).`;

function createHandlers({ state, limits, pixels, events, cleaner, canvas, discord, now = () => Date.now() }) {
  const reply = createReplier({ discord });

  return {
    get: async (event) => {
      const image = renderCanvas(await canvas.visiblePixels());
      const content = image.count === 0 ? EMPTY_CANVAS : canvasImage(image);
      await reply(event, content, [{ name: imageName(new Date(now())), data: image.png, contentType: "image/png" }]);
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
  canvasImage,
  imageName,
  cleared,
  limitSet,
  drawn,
  rateLimited
};
