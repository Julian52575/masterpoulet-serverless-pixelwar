const { isWebhookUrl } = require("./discord");

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 7 * 24 * 60;
const DEFAULT_POST_EVERY_MINUTES = 60;
const SCHEDULE_PERIOD_MINUTES = 5;

function loadConfig(env = process.env) {
  const bucket = String(env.SNAPSHOT_BUCKET ?? "").trim();
  const storageEndpoint = String(env.STORAGE_API_ENDPOINT ?? "").trim() || null;
  const rawTtl = String(env.SIGNED_URL_TTL_MINUTES ?? "").trim();
  const ttlMinutes = rawTtl === "" ? DEFAULT_TTL_MINUTES : Number(rawTtl);
  const webhookUrl = String(env.SNAPSHOT_WEBHOOK_URL ?? "").trim() || null;
  const rawEvery = String(env.SCHEDULED_POST_EVERY_MINUTES ?? "").trim();
  const postEveryMinutes = rawEvery === "" ? DEFAULT_POST_EVERY_MINUTES : Number(rawEvery);
  const problems = [];

  if (!bucket) problems.push("SNAPSHOT_BUCKET is not configured");
  else if (!BUCKET_NAME.test(bucket)) problems.push("SNAPSHOT_BUCKET is not a valid bucket name");

  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_TTL_MINUTES) {
    problems.push(`SIGNED_URL_TTL_MINUTES must be a whole number between 1 and ${MAX_TTL_MINUTES}`);
  }

  if (webhookUrl && !isWebhookUrl(webhookUrl)) {
    problems.push("SNAPSHOT_WEBHOOK_URL must be a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>)");
  }

  if (!Number.isInteger(postEveryMinutes) || postEveryMinutes < SCHEDULE_PERIOD_MINUTES || postEveryMinutes > MAX_TTL_MINUTES) {
    problems.push(`SCHEDULED_POST_EVERY_MINUTES must be a whole number between ${SCHEDULE_PERIOD_MINUTES} and ${MAX_TTL_MINUTES}`);
  }

  return { bucket, storageEndpoint, ttlMinutes, webhookUrl, postEveryMinutes, problems };
}

module.exports = {
  loadConfig,
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  DEFAULT_POST_EVERY_MINUTES,
  SCHEDULE_PERIOD_MINUTES
};
