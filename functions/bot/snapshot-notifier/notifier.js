const { parseStorageEvent, InvalidEventError } = require("./cloudevent");
const { log } = require("./logger");

const ACK = 204;
const REJECT = 400;
const RETRY = 500;
const SNAPSHOT_PREFIX = "snapshots/";

const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;

function readableTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function snapshotMessage({ url, requestedAt, pixelCount, ttlMinutes }) {
  const when = readableTime(requestedAt);
  const count = Number.parseInt(pixelCount, 10);
  const details = [when && `du ${when}`, Number.isInteger(count) && plural(count, "pixel")].filter(Boolean);
  const validity = ttlMinutes % 60 === 0 ? plural(ttlMinutes / 60, "heure") : plural(ttlMinutes, "minute");
  return `📸 Snapshot${details.length ? ` ${details.join(", ")}` : ""} : ${url}\n(lien valable ${validity})`;
}

function createNotifier({ files, discord, bucket, ttlMinutes }) {
  return async function handle(headers, rawBody) {
    let event;
    try {
      event = parseStorageEvent(headers, rawBody);
    } catch (error) {
      if (!(error instanceof InvalidEventError)) throw error;
      log.warn("invalid storage event", { error: error.message });
      return { statusCode: REJECT };
    }

    const fields = { event_id: event.id, object: event.name };
    if (!event.finalized || event.bucket !== bucket || !event.name.startsWith(SNAPSHOT_PREFIX) || !event.name.endsWith(".png")) {
      log.info("storage event ignored", { ...fields, event_type: event.type, bucket: event.bucket });
      return { statusCode: ACK };
    }

    let metadata;
    try {
      metadata = await files.metadataOf(event.name);
    } catch (error) {
      log.error("could not read snapshot metadata", { ...fields, error: error.message });
      return { statusCode: RETRY };
    }

    const context = { ...fields, correlation_id: metadata.correlation_id, snapshot_id: metadata.snapshot_id };
    if (!metadata.application_id || !metadata.interaction_token) {
      log.warn("snapshot has no Discord interaction to answer", context);
      return { statusCode: ACK };
    }

    try {
      const url = await files.signedUrl(event.name, ttlMinutes);
      await discord.editOriginal(
        { application_id: metadata.application_id, interaction_token: metadata.interaction_token },
        { content: snapshotMessage({ url, requestedAt: metadata.requested_at, pixelCount: metadata.pixel_count, ttlMinutes }) }
      );
      log.info("snapshot link sent", { ...context, ttl_minutes: ttlMinutes });
      return { statusCode: ACK };
    } catch (error) {
      if (error.status !== undefined && !error.retryable) {
        log.warn("could not send the snapshot link to Discord", { ...context, error: error.message, status: error.status });
        return { statusCode: ACK };
      }
      log.error("snapshot notification failed", { ...context, error: error.message, status: error.status });
      return { statusCode: RETRY };
    }
  };
}

module.exports = { createNotifier, snapshotMessage, SNAPSHOT_PREFIX };
