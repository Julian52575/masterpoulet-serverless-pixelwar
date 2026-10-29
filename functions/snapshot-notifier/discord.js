const DISCORD_API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10000;
const UPLOAD_TIMEOUT_MS = 30000;
const FILENAME = /^[A-Za-z0-9_.-]{1,100}$/;
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

function multipart(payload, files) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    ...payload,
    attachments: files.map((file, id) => ({ id, filename: file.name }))
  }));
  files.forEach((file, id) => {
    if (!FILENAME.test(file.name)) throw new Error("invalid attachment filename");
    form.append(`files[${id}]`, new Blob([file.data], { type: file.contentType }), file.name);
  });
  return form;
}

function createDiscordClient({ fetch = globalThis.fetch, baseUrl = DISCORD_API } = {}) {
  async function editOriginal(event, message, files = []) {
    const payload = { allowed_mentions: { parse: [] }, ...message };
    const request = files.length > 0
      ? { body: multipart(payload, files), timeout: UPLOAD_TIMEOUT_MS }
      : { body: JSON.stringify(payload), headers: { "content-type": "application/json" }, timeout: TIMEOUT_MS };

    const response = await fetch(webhookUrl(baseUrl, event), {
      method: "PATCH",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeout)
    });

    if (!response.ok) {
      throw new DiscordApiError(response.status, await response.text().catch(() => ""));
    }
  }

  return { editOriginal };
}

module.exports = { createDiscordClient, DiscordApiError };
