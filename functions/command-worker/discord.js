const DISCORD_API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10000;
const SNOWFLAKE = /^\d{1,20}$/;
const TOKEN = /^[A-Za-z0-9_.-]{1,500}$/;

class DiscordApiError extends Error {
  constructor(status, body) {
    super(`Discord API responded ${status}`);
    this.status = status;
    this.body = body;
    this.retryable = status === 429 || status >= 500;
  }
}

function webhookUrl(baseUrl, event) {
  const appId = String(event?.application_id ?? "");
  const token = String(event?.interaction_token ?? "");
  if (!SNOWFLAKE.test(appId)) throw new Error("invalid application_id");
  if (!TOKEN.test(token)) throw new Error("invalid interaction_token");
  return `${baseUrl}/webhooks/${appId}/${token}/messages/@original`;
}

function createDiscordClient({ fetch = globalThis.fetch, baseUrl = DISCORD_API } = {}) {
  async function editOriginal(event, message) {
    const response = await fetch(webhookUrl(baseUrl, event), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...message }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new DiscordApiError(response.status, await response.text().catch(() => ""));
    }
  }

  return { editOriginal };
}

module.exports = { createDiscordClient, DiscordApiError };
