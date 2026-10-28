const { randomUUID } = require("node:crypto");
const nacl = require("tweetnacl");
const { log } = require("./logger");
const { parseInteraction } = require("./interaction");
const { publishCommand } = require("./publisher");
const { readPublicKey } = require("./config");

const EPHEMERAL = 64;

function reply(statusCode, body, correlationId) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId
    },
    body: JSON.stringify(body)
  };
}

const MAX_TIMESTAMP_AGE_SECONDS = 300;

function verifyDiscordRequest(publicKey, signature, timestamp, rawBody) {
  if (!publicKey || !signature || !timestamp || rawBody == null) {
    return false;
  }

  try {
    if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
    if (!/^[0-9a-f]{64}$/i.test(publicKey)) return false;
    if (!/^\d+$/.test(timestamp)) return false;

    const age = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (age < -30 || age > MAX_TIMESTAMP_AGE_SECONDS) return false;

    const body = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody, "utf8");

    const message = Buffer.concat([
      Buffer.from(timestamp, "utf8"),
      body
    ]);

    return nacl.sign.detached.verify(
      message,
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
}

function createHandler({ publish }) {
  return async function handler(event) {
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([key, value]) => [
        key.toLowerCase(),
        value
      ])
    );

    const publicKey = readPublicKey();
    const signature = headers["x-signature-ed25519"];
    const timestamp = headers["x-signature-timestamp"];

    const encodedBody = event.body ?? "";
    let rawBody;

    try {
      rawBody = event.isBase64Encoded
        ? Buffer.from(encodedBody, "base64")
        : Buffer.from(encodedBody, "utf8");
    } catch {
      log.warn("invalid request body encoding");
      return { statusCode: 400, body: "Invalid request body" };
    }

    if (!publicKey) {
      log.error("DISCORD_PUBLIC_KEY is not configured");
    }

    if (!verifyDiscordRequest(publicKey, signature, timestamp, rawBody)) {
      log.warn("discord signature rejected", {
        has_signature: Boolean(signature),
        has_timestamp: Boolean(timestamp)
      });
      return {
        statusCode: 401,
        headers: { "content-type": "text/plain" },
        body: "Invalid or missing Discord signature"
      };
    }

    let interaction;

    try {
      interaction = JSON.parse(rawBody.toString("utf8"));
    } catch {
      log.warn("signed body is not valid JSON");
      return { statusCode: 400, body: "Invalid JSON" };
    }

    if (interaction.type === 1) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: 1 })
      };
    }

    if (interaction.type === 2) {
      const correlationId = randomUUID();
      const command = parseInteraction(interaction);

      if (!command) {
        log.warn("unknown discord command", {
          correlation_id: correlationId,
          command: interaction.data?.name
        });
        return reply(200, {
          type: 4,
          data: { content: "Commande inconnue.", flags: EPHEMERAL }
        }, correlationId);
      }

      const fields = {
        correlation_id: correlationId,
        command: command.type,
        user_id: command.user_id,
        interaction_id: command.interaction_id,
        guild_id: command.guild_id
      };
      log.info("discord command received", fields);

      try {
        const messageId = await publish({ ...command, correlation_id: correlationId });
        log.info("discord command published", { ...fields, message_id: messageId });
      } catch (error) {
        log.error("failed to publish discord command", { ...fields, error: error.message });
        return reply(500, { error: "Failed to queue command" }, correlationId);
      }

      const deferred = command.type.startsWith("admin.")
        ? { type: 5, data: { flags: EPHEMERAL } }
        : { type: 5 };
      return reply(200, deferred, correlationId);
    }

    log.warn("unsupported interaction type", { interaction_type: interaction.type });
    return { statusCode: 400, body: "Unsupported interaction type" };
  };
}

const handler = createHandler({ publish: publishCommand });

module.exports = { createHandler, handler, verifyDiscordRequest };
