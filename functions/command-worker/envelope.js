class InvalidMessageError extends Error {}

function parseJson(text, problem) {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidMessageError(problem);
  }
}

function parsePushMessage(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const envelope = parseJson(text, "body is not valid JSON");

  const message = envelope?.message;
  if (!message || typeof message.data !== "string") {
    throw new InvalidMessageError("missing message.data");
  }

  const event = parseJson(
    Buffer.from(message.data, "base64").toString("utf8"),
    "message.data is not base64-encoded JSON"
  );
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
    throw new InvalidMessageError("event has no type");
  }

  return {
    event,
    messageId: message.messageId ?? message.message_id ?? null,
    attributes: message.attributes ?? {},
    deliveryAttempt: envelope.deliveryAttempt ?? null,
    subscription: envelope.subscription ?? null
  };
}

module.exports = { parsePushMessage, InvalidMessageError };
