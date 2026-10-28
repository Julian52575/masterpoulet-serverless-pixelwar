const { randomUUID } = require("node:crypto");
const nacl = require("tweetnacl");

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

async function handler(event) {
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const signature = headers["x-signature-ed25519"];
  const timestamp = headers["x-signature-timestamp"];

  const encodedBody = event.body ?? "";
  let rawBody;

  try {
    rawBody = event.isBase64Encoded
      ? Buffer.from(encodedBody, "base64")
      : Buffer.from(encodedBody, "utf8");
  } catch {
    return { statusCode: 400, body: "Invalid request body" };
  }

  if (!verifyDiscordRequest(publicKey, signature, timestamp, rawBody)) {
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
    const commandName = interaction.data?.name;
    const correlationId = randomUUID();

    console.log("Discord command received:", {
      correlation_id: correlationId,
      commandName,
      interactionId: interaction.id,
      guildId: interaction.guild_id
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId
      },
      body: JSON.stringify({ type: 5 })
    };
  }

  return { statusCode: 400, body: "Unsupported interaction type" };
}

module.exports = { handler, verifyDiscordRequest };
