const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const USERS_ME = "https://discord.com/api/v10/users/@me";
const SCOPE = "identify";
const TIMEOUT_MS = 5000;

class InvalidCodeError extends Error {}
class DiscordUnavailableError extends Error {}

function createDiscordOAuth({ clientId, clientSecret, redirectUri, fetch = globalThis.fetch }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  function authorizeUrl(state) {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SCOPE,
      redirect_uri: redirectUri,
      state
    }).toString();
    return url.href;
  }

  async function call(url, options) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new DiscordUnavailableError(`discord unreachable: ${error.message}`);
    }
  }

  async function exchange(code) {
    const res = await call(TOKEN_URL, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString()
    });

    if (res.status === 400 || res.status === 401) throw new InvalidCodeError(`discord refused the code (${res.status})`);
    if (!res.ok) throw new DiscordUnavailableError(`discord answered ${res.status}`);

    const body = await res.json().catch(() => null);
    if (typeof body?.access_token !== "string" || body.token_type !== "Bearer") {
      throw new DiscordUnavailableError("discord returned no bearer token");
    }
    const scopes = String(body.scope ?? "").split(" ");
    if (!scopes.includes(SCOPE)) throw new InvalidCodeError("the identify scope was not granted");

    return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 0, scope: body.scope };
  }

  async function fetchUser(accessToken) {
    const res = await call(USERS_ME, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new DiscordUnavailableError(`discord answered ${res.status} to /users/@me`);
    const body = await res.json().catch(() => null);
    if (typeof body?.id !== "string") throw new DiscordUnavailableError("discord returned no user id");
    return { userId: body.id, username: body.global_name ?? body.username ?? null };
  }

  return { authorizeUrl, exchange, fetchUser };
}

module.exports = {
  createDiscordOAuth,
  InvalidCodeError,
  DiscordUnavailableError,
  AUTHORIZE_URL,
  TOKEN_URL,
  USERS_ME,
  SCOPE
};
