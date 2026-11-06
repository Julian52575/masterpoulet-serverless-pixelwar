const OBJECT_FINALIZED = "google.cloud.storage.object.v1.finalized";

class InvalidEventError extends Error {}

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseStorageEvent(headers, rawBody) {
  const type = header(headers, "ce-type");
  if (!type) throw new InvalidEventError("missing ce-type header");

  let data;
  try {
    data = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? ""));
  } catch {
    throw new InvalidEventError("body is not valid JSON");
  }
  if (typeof data?.bucket !== "string" || typeof data?.name !== "string") {
    throw new InvalidEventError("missing bucket or object name");
  }

  return {
    id: header(headers, "ce-id") ?? null,
    type,
    finalized: type === OBJECT_FINALIZED,
    bucket: data.bucket,
    name: data.name
  };
}

module.exports = { parseStorageEvent, InvalidEventError, OBJECT_FINALIZED };
