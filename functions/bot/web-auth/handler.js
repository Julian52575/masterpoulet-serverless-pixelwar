const { randomBytes, timingSafeEqual } = require("node:crypto");
const { InvalidCodeError, DiscordUnavailableError } = require("./oauth");
const { log } = require("./logger");

const STATE_COOKIE = "__Host-pixelwar_oauth_state";
const STATE_TTL_SECONDS = 600;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{1,100}$/;
const ROUTES = { "/auth/login": "login", "/auth/callback": "callback" };

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
};

const newState = () => randomBytes(32).toString("base64url");

function routeOf(path) {
  const clean = String(path ?? "").replace(/\/+$/, "").replace(/^\/api(?=\/)/, "");
  return ROUTES[clean] ?? null;
}

function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sameState(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !STATE.test(a) || !STATE.test(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const stateCookie = (value, maxAge) =>
  `${STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

function redirect(location, extra = {}) {
  return { statusCode: 302, headers: { ...SECURITY_HEADERS, location, ...extra }, body: "" };
}

function createHandler({ oauth, appUrl, randomState = newState }) {
  const backToApp = (params) => `${appUrl}#${new URLSearchParams(params).toString()}`;
  const fail = (reason) => redirect(backToApp({ auth_error: reason }), { "set-cookie": stateCookie("", 0) });

  async function callback(query, headers) {
    if (query.error) {
      log.info("discord login cancelled", { reason: String(query.error).slice(0, 50) });
      return fail("access_denied");
    }

    if (!sameState(query.state, readCookie(headers.cookie, STATE_COOKIE))) {
      log.warn("oauth state mismatch", { has_state: Boolean(query.state), has_cookie: Boolean(headers.cookie) });
      return fail("invalid_state");
    }

    if (typeof query.code !== "string" || !CODE.test(query.code)) {
      log.warn("oauth callback without a valid code");
      return fail("invalid_code");
    }

    try {
      const token = await oauth.exchange(query.code);
      const user = await oauth.fetchUser(token.accessToken);
      log.info("discord login", { user_id: user.userId, expires_in: token.expiresIn });
      return redirect(
        backToApp({ access_token: token.accessToken, token_type: "Bearer", expires_in: String(token.expiresIn) }),
        { "set-cookie": stateCookie("", 0) }
      );
    } catch (error) {
      if (error instanceof InvalidCodeError) {
        log.warn("discord refused the login", { error: error.message });
        return fail("invalid_code");
      }
      if (error instanceof DiscordUnavailableError) {
        log.error("discord login failed", { error: error.message });
        return fail("discord_unavailable");
      }
      throw error;
    }
  }

  return async function handle({ method, path, query = {}, headers = {} }) {
    const route = routeOf(path);
    if (!route) return { statusCode: 404, headers: SECURITY_HEADERS, body: "Not Found" };
    if (method !== "GET") return { statusCode: 405, headers: { ...SECURITY_HEADERS, allow: "GET" }, body: "" };

    if (route === "login") {
      const state = randomState();
      return redirect(oauth.authorizeUrl(state), { "set-cookie": stateCookie(state, STATE_TTL_SECONDS) });
    }
    return callback(query, headers);
  };
}

module.exports = { createHandler, readCookie, STATE_COOKIE };
