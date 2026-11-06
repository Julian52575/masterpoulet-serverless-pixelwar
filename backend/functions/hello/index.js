const functions = require("@google-cloud/functions-framework");
const { verifyKey, InteractionType, InteractionResponseType } = require("discord-interactions");

functions.http("hello", async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const signature = req.get("X-Signature-Ed25519");
  const timestamp = req.get("X-Signature-Timestamp");
  const valid =
    signature && timestamp && (await verifyKey(req.rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY));
  if (!valid) return res.status(401).send("invalid request signature");

  const { type, data } = req.body;

  if (type === InteractionType.PING) return res.json({ type: InteractionResponseType.PONG });

  if (type === InteractionType.APPLICATION_COMMAND && data.name === "hello") {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Hello, world!" },
    });
  }

  res.status(400).json({ error: "unknown interaction" });
});
