const { tileId } = require("./pixels");

const PIXEL_PROCESSED = "pixel.processed";
const CANVAS_CLEARED = "canvas.cleared";

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

  return { pixelProcessed, canvasCleared };
}

module.exports = { createPixelEvents, PIXEL_PROCESSED, CANVAS_CLEARED };
