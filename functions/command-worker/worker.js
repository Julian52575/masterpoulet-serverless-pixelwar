const { parsePushMessage, InvalidMessageError } = require("./envelope");
const { log } = require("./logger");

const ACK = 204;
const REJECT = 400;
const RETRY = 500;

const REFUSED = "⛔ Cette commande est réservée aux administrateurs.";

function createWorker({ handlers, authorizer, discord }) {
  async function refuse(event, fields) {
    log.warn("admin command refused", fields);
    try {
      await discord.editOriginal(event, { content: REFUSED });
    } catch (error) {
      log.warn("could not tell the user the command was refused", {
        ...fields,
        error: error.message,
        status: error.status
      });
      if (error.retryable) return { statusCode: RETRY };
    }
    return { statusCode: ACK };
  }

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
      command: event.type,
      user_id: event.user_id,
      interaction_id: event.interaction_id,
      message_id: messageId,
      delivery_attempt: deliveryAttempt
    };

    if (!Object.hasOwn(handlers, event.type)) {
      log.warn("unsupported command type", fields);
      return { statusCode: REJECT };
    }

    if (authorizer.requiresAdmin(event.type) && !authorizer.isAdmin(event)) {
      return refuse(event, fields);
    }

    log.info("command received", fields);
    const started = Date.now();

    try {
      await handlers[event.type](event);
    } catch (error) {
      log.error("command failed", { ...fields, error: error.message, duration_ms: Date.now() - started });
      return { statusCode: RETRY };
    }

    log.info("command processed", { ...fields, duration_ms: Date.now() - started });
    return { statusCode: ACK };
  };
}

module.exports = { createWorker };
