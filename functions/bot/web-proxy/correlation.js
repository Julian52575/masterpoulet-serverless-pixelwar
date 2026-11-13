const { randomUUID } = require("node:crypto");

const CORRELATION_ID = /^[A-Za-z0-9_-]{8,64}$/;

function correlationIdFrom(headers = {}) {
  const sent = headers["x-correlation-id"];
  return typeof sent === "string" && CORRELATION_ID.test(sent) ? sent : randomUUID();
}

module.exports = { correlationIdFrom, CORRELATION_ID };
