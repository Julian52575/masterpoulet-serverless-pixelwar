const { renderCanvas } = require("./render");
const { SNAPSHOT_PREFIX } = require("./storage");

const SNAPSHOT_REQUESTED = "snapshot.requested";
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

class InvalidRequestError extends Error {}

function readRequest(event) {
  if (event.type !== SNAPSHOT_REQUESTED) throw new InvalidRequestError(`unexpected event type ${event.type}`);
  if (typeof event.snapshot_id !== "string" || !SAFE_ID.test(event.snapshot_id)) {
    throw new InvalidRequestError("invalid snapshot_id");
  }
  const requestedAt = new Date(event.requested_at);
  if (Number.isNaN(requestedAt.getTime())) throw new InvalidRequestError("invalid requested_at");
  return { snapshotId: event.snapshot_id, requestedAt };
}

function snapshotName(requestedAt, snapshotId) {
  return `${SNAPSHOT_PREFIX}${requestedAt.toISOString().replace(/[:.]/g, "-")}_${snapshotId}.png`;
}

function createSnapshotTaker({ canvas, store }) {
  return async function takeSnapshot(event) {
    const { snapshotId, requestedAt } = readRequest(event);
    const image = renderCanvas(await canvas.visiblePixels());
    const name = snapshotName(requestedAt, snapshotId);

    const location = await store.save({
      name,
      png: image.png,
      metadata: {
        snapshot_id: snapshotId,
        requested_at: requestedAt.toISOString(),
        requested_by: String(event.requested_by ?? ""),
        pixel_count: String(image.count),
        application_id: String(event.application_id ?? ""),
        interaction_token: String(event.interaction_token ?? ""),
        channel_id: String(event.channel_id ?? ""),
        correlation_id: String(event.correlation_id ?? "")
      }
    });

    return { name, location, count: image.count, bytes: image.png.length };
  };
}

module.exports = { createSnapshotTaker, snapshotName, InvalidRequestError, SNAPSHOT_REQUESTED };
