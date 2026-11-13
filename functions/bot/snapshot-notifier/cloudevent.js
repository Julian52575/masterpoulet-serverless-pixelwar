const OBJECT_FINALIZED = "google.cloud.storage.object.v1.finalized";
const OBJECT_FINALIZE = "OBJECT_FINALIZE";

class InvalidEventError extends Error {}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(rawBody) {
  try {
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? ""));
  } catch {
    throw new InvalidEventError("body is not valid JSON");
  }
}

function fromCloudEvent(type, headers, data) {
  if (typeof data?.bucket !== "string" || typeof data?.name !== "string") {
    throw new InvalidEventError("missing bucket or object name");
  }
  return {
    source: "eventarc",
    id: header(headers, "ce-id") ?? null,
    type,
    finalized: type === OBJECT_FINALIZED,
    bucket: data.bucket,
    name: data.name,
    deliveryAttempt: null
  };
}

function fromPubSub(envelope) {
  const message = envelope?.message;
  const attributes = message?.attributes;
  if (!attributes || typeof attributes !== "object") throw new InvalidEventError("missing message.attributes");

  const { eventType, bucketId, objectId } = attributes;
  if (typeof eventType !== "string") throw new InvalidEventError("missing eventType attribute");
  if (typeof bucketId !== "string" || typeof objectId !== "string") {
    throw new InvalidEventError("missing bucketId or objectId attribute");
  }

  return {
    source: "pubsub",
    id: message.messageId ?? message.message_id ?? null,
    type: eventType,
    finalized: eventType === OBJECT_FINALIZE,
    bucket: bucketId,
    name: objectId,
    deliveryAttempt: envelope.deliveryAttempt ?? null
  };
}

function parseStorageEvent(headers, rawBody) {
  const type = header(headers, "ce-type");
  const body = parseJson(rawBody);
  return type ? fromCloudEvent(type, headers, body) : fromPubSub(body);
}

module.exports = { parseStorageEvent, InvalidEventError, OBJECT_FINALIZED, OBJECT_FINALIZE };
