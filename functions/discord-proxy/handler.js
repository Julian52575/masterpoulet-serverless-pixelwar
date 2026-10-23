const nacl = require("tweetnacl");

function verifyDiscordRequest(publicKey, signature, timestamp, rawBody) {
  if (!publicKey || !signature || !timestamp || rawBody == null) {
    return false;
  }

  try {
    return nacl.sign.detached.verify(
      Buffer.concat([
        Buffer.from(timestamp, "utf8"),
        Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.from(rawBody, "utf8")
      ]),
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

  if (!publicKey || !signature || !timestamp) {
    return {
      statusCode: 401,
      body: "Missing Discord signature"
    };
  }

  const rawBody = event.body ?? "";

  if (
    !verifyDiscordRequest(publicKey, signature, timestamp, rawBody)
  ) {
    return {
      statusCode: 401,
      body: "Invalid Discord signature"
    };
  }

  let interaction;

  try {
    interaction = JSON.parse(
      event.isBase64Encoded
        ? Buffer.from(rawBody, "base64").toString("utf8")
        : rawBody
    );
  } catch {
    return {
      statusCode: 400,
      body: "Invalid JSON"
    };
  }

  if (interaction.type === 1) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: 1 })
    };
  }

  if (interaction.type === 2) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: 5 })
    };
  }

  return {
    statusCode: 400,
    body: "Unsupported interaction type"
  };
}

module.exports = { handler, verifyDiscordRequest };
