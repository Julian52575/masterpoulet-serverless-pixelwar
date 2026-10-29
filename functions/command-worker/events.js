const { tileId } = require("./pixels");

const PIXEL_PROCESSED = "pixel.processed";

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

  return { pixelProcessed };
}

module.exports = { createPixelEvents, PIXEL_PROCESSED };
