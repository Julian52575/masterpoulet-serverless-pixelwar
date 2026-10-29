const { parsePushMessage, InvalidMessageError } = require("./envelope");
const { InvalidRequestError } = require("./snapshot");
const { log } = require("./logger");

const ACK = 204;
const REJECT = 400;
const RETRY = 500;

function createWorker({ takeSnapshot }) {
  return async function handle(rawBody) {
    let message;
    try {
      message = parsePushMessage(rawBody);
    } catch (error) {
      if (!(error instanceof InvalidMessageError)) throw error;
      log.warn("invalid pubsub push message", { error: error.message });
      return { statusCode: REJECT };
    }

    const { event, messageId, deliveryAttempt } = message;
    const fields = {
      correlation_id: event.correlation_id,
      snapshot_id: event.snapshot_id,
      requested_by: event.requested_by,
      message_id: messageId,
      delivery_attempt: deliveryAttempt
    };

    log.info("snapshot requested", fields);
    const started = Date.now();

    try {
      const result = await takeSnapshot(event);
      log.info("snapshot stored", {
        ...fields,
        object: result.name,
        pixel_count: result.count,
        bytes: result.bytes,
        duration_ms: Date.now() - started
      });
      return { statusCode: ACK };
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        log.warn("invalid snapshot request", { ...fields, error: error.message });
        return { statusCode: REJECT };
      }
      log.error("snapshot failed", { ...fields, error: error.message, duration_ms: Date.now() - started });
      return { statusCode: RETRY };
    }
  };
}

module.exports = { createWorker };
