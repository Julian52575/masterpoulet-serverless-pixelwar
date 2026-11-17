const { randomUUID } = require("node:crypto");
const { routeOf, readDraw, areaOf, InvalidDrawError } = require("./draws");
const { UnauthorizedError, DiscordUnavailableError } = require("./auth");
const { log } = require("./logger");
const { correlationIdFrom } = require("./correlation");
const { annotate } = require("./tracing");

const MAX_BODY_BYTES = 1024;
const DISCORD_RETRY_SECONDS = 5;

function answer(statusCode, body, correlationId, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "x-correlation-id": correlationId, ...headers },
    body: JSON.stringify(body)
  };
}

function parseBody(rawBody) {
  if (rawBody.length > MAX_BODY_BYTES) throw new InvalidDrawError("the body is too large");
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new InvalidDrawError("the body is not valid JSON");
  }
}

function createHandler({ authenticate, quota, publish, now = () => new Date() }) {
  return async function handle({ method, path, headers = {}, rawBody = Buffer.alloc(0) }) {
    const correlationId = correlationIdFrom(headers);
    annotate({ correlation_id: correlationId });
    const route = routeOf(path);
    if (!route) return answer(404, { error: "not found" }, correlationId);
    if (method !== "POST") return answer(405, { error: "method not allowed" }, correlationId, { allow: "POST" });

    let user;
    try {
      user = await authenticate(headers["x-forwarded-authorization"] ?? headers.authorization);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        log.warn("web draw unauthorized", { correlation_id: correlationId, reason: error.message });
        return answer(401, { error: "invalid or missing Discord token" }, correlationId, { "www-authenticate": "Bearer" });
      }
      if (error instanceof DiscordUnavailableError) {
        log.error("discord user check failed", { correlation_id: correlationId, error: error.message });
        return answer(503, { error: "cannot check the Discord token, try again" }, correlationId, {
          "retry-after": String(DISCORD_RETRY_SECONDS)
        });
      }
      throw error;
    }

    const fields = { correlation_id: correlationId, user_id: user.user_id, route, auth_cached: user.cached };
    annotate({ user_id: user.user_id, route });

    let draw;
    try {
      draw = readDraw(route, parseBody(rawBody));
    } catch (error) {
      if (!(error instanceof InvalidDrawError)) throw error;
      log.warn("invalid web draw", { ...fields, error: error.message });
      return answer(400, { error: error.message }, correlationId);
    }

    const area = areaOf(draw.rect);
    const check = await quota.check(user.user_id, area);
    if (check.status === "paused") {
      log.info("web draw refused: paused", fields);
      return answer(423, { error: "drawing is paused" }, correlationId);
    }
    if (check.status === "rate_limited") {
      log.info("web draw refused: rate limited", { ...fields, limit: check.limit });
      return answer(429, { error: "rate limited", limit: check.limit, retry_after: check.retryAfterSeconds }, correlationId, {
        "retry-after": String(check.retryAfterSeconds)
      });
    }

    const event = {
      type: "web.draw",
      source: "web",
      user_id: user.user_id,
      username: user.username,
      rect: draw.rect,
      color: draw.color,
      request_id: randomUUID(),
      requested_at: now().toISOString(),
      correlation_id: correlationId
    };

    try {
      const messageId = await publish(event);
      log.info("web draw published", { ...fields, message_id: messageId, area, accepted: check.accepted });
    } catch (error) {
      log.error("failed to publish web draw", { ...fields, error: error.message });
      return answer(500, { error: "failed to queue the draw" }, correlationId);
    }

    return answer(202, { accepted: check.accepted }, correlationId);
  };
}

module.exports = { createHandler, MAX_BODY_BYTES };
