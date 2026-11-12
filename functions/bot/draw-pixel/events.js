const { tileId } = require("./pixels");

const PIXEL_PROCESSED = "pixel.processed";
const CANVAS_CLEARED = "canvas.cleared";
const PIXELS_PROCESSED = "pixels.processed";
const CANVAS_PAUSED = "canvas.paused";
const CANVAS_RESUMED = "canvas.resumed";

function createPixelEvents({ topic }) {
  async function pixelProcessed({ x, y, color, author, authorName, updatedAt, correlationId }) {
    const event = {
      type: PIXEL_PROCESSED,
      x,
      y,
      tile: tileId(x, y),
      color,
      author,
      author_name: authorName ?? null,
      updated_at: updatedAt.toISOString(),
      correlation_id: correlationId ?? null
    };

    return topic.publishMessage({
      json: event,
      attributes: {
        type: PIXEL_PROCESSED,
        tile: event.tile,
        correlation_id: correlationId ?? ""
      }
    });
  }

  async function canvasCleared({ clearedAt, clearedBy, correlationId }) {
    const event = {
      type: CANVAS_CLEARED,
      cleared_at: clearedAt.toISOString(),
      cleared_by: clearedBy,
      correlation_id: correlationId ?? null
    };

    return topic.publishMessage({
      json: event,
      attributes: { type: CANVAS_CLEARED, correlation_id: correlationId ?? "" }
    });
  }

  async function pixelsProcessed({ cells, color, author, authorName, updatedAt, correlationId }) {
    const updated = updatedAt.toISOString();
    const event = {
      type: PIXELS_PROCESSED,
      pixels: cells.map(({ x, y }) => ({ x, y, color, author, author_name: authorName ?? null, updated_at: updated })),
      tiles: [...new Set(cells.map(({ x, y }) => tileId(x, y)))],
      correlation_id: correlationId ?? null
    };

    return topic.publishMessage({
      json: event,
      attributes: { type: PIXELS_PROCESSED, correlation_id: correlationId ?? "" }
    });
  }

  async function pauseChanged({ paused, by, at, correlationId }) {
    const type = paused ? CANVAS_PAUSED : CANVAS_RESUMED;
    const event = { type, by, at: at.toISOString(), correlation_id: correlationId ?? null };

    return topic.publishMessage({
      json: event,
      attributes: { type, correlation_id: correlationId ?? "" }
    });
  }

  return { pixelProcessed, canvasCleared, pixelsProcessed, pauseChanged };
}

module.exports = {
  createPixelEvents,
  PIXEL_PROCESSED,
  CANVAS_CLEARED,
  PIXELS_PROCESSED,
  CANVAS_PAUSED,
  CANVAS_RESUMED
};
