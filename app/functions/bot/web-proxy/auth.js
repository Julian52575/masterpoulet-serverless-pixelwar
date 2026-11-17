const { createHash } = require("node:crypto");

const USERS_ME = "https://discord.com/api/v10/users/@me";
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{1,256})$/;
const SNOWFLAKE = /^\d{1,20}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 10000;
const TIMEOUT_MS = 3000;

class UnauthorizedError extends Error {}
class DiscordUnavailableError extends Error {}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

function createDiscordAuth({
  fetch = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = CACHE_TTL_MS,
  maxEntries = MAX_CACHE_ENTRIES
} = {}) {
  const cache = new Map();

  function remember(key, user) {
    cache.delete(key);
    cache.set(key, { user, expiresAt: now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    return entry.user;
  }

  async function askDiscord(token) {
    let res;
    try {
      res = await fetch(USERS_ME, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      throw new DiscordUnavailableError(`discord unreachable: ${error.message}`);
    }

    if (res.status === 401 || res.status === 403) throw new UnauthorizedError("token refused by discord");
    if (!res.ok) throw new DiscordUnavailableError(`discord answered ${res.status}`);

    const body = await res.json().catch(() => null);
    if (typeof body?.id !== "string" || !SNOWFLAKE.test(body.id)) {
      throw new DiscordUnavailableError("discord returned no user id");
    }
    return { user_id: body.id, username: body.global_name ?? body.username ?? null };
  }

  async function authenticate(header) {
    const match = typeof header === "string" ? BEARER.exec(header.trim()) : null;
    if (!match) throw new UnauthorizedError("missing or malformed bearer token");

    const key = hashToken(match[1]);
    const known = cached(key);
    if (known) return { ...known, cached: true };

    const user = await askDiscord(match[1]);
    remember(key, user);
    return { ...user, cached: false };
  }

  return { authenticate, size: () => cache.size };
}

module.exports = { createDiscordAuth, hashToken, UnauthorizedError, DiscordUnavailableError, USERS_ME, CACHE_TTL_MS };
