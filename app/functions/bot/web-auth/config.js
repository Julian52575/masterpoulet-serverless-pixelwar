const SNOWFLAKE = /^\d{1,20}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function readUrl(value) {
  try {
    return new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
}

function isSafeUrl(url) {
  if (!url || url.hash || url.username || url.password) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
}

function loadConfig(env = process.env) {
  const clientId = String(env.DISCORD_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.DISCORD_CLIENT_SECRET ?? "").trim();
  const redirectUri = readUrl(env.OAUTH_REDIRECT_URI);
  const appUrl = readUrl(env.APP_URL);
  const problems = [];

  if (!clientId) problems.push("DISCORD_CLIENT_ID is not configured");
  else if (!SNOWFLAKE.test(clientId)) problems.push("DISCORD_CLIENT_ID must be a Discord application id");
  if (!clientSecret) problems.push("DISCORD_CLIENT_SECRET is not configured");
  if (!isSafeUrl(redirectUri)) problems.push("OAUTH_REDIRECT_URI must be an https URL without a fragment");
  if (!isSafeUrl(appUrl)) problems.push("APP_URL must be an https URL without a fragment");

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri?.href,
    appUrl: appUrl?.href,
    problems
  };
}

module.exports = { loadConfig };
