const { randomBytes } = require("node:crypto");

const ROUTES = { pixel: "/pixels", brush: "/brush" };
const GRID = 10000;
const MAX_BRUSH = 16;
const DEFAULTS = {
  requests: 200,
  concurrency: 20,
  rate: 0,
  route: "pixel",
  size: 4,
  x: 0,
  y: 0,
  width: 256,
  timeout: 10
};

class UsageError extends Error {}

const USAGE = `Usage: PIXELWAR_TOKENS=<token>[,<token>...] node burst.js --url <api base url> [options]

Options:
  --requests <n>      number of draws to send (default ${DEFAULTS.requests})
  --concurrency <n>   draws in flight at the same time (default ${DEFAULTS.concurrency})
  --rate <n>          maximum draws started per second, 0 = no limit (default ${DEFAULTS.rate})
  --route <name>      pixel or brush (default ${DEFAULTS.route})
  --size <n>          brush size, 1 to ${MAX_BRUSH} (default ${DEFAULTS.size})
  --x <n> --y <n>     top-left corner of the drawing zone (default ${DEFAULTS.x},${DEFAULTS.y})
  --width <n>         side of the square drawing zone (default ${DEFAULTS.width})
  --timeout <s>       seconds before a draw is counted as failed (default ${DEFAULTS.timeout})
  --help              show this help`;

function wholeNumber(name, value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new UsageError(`--${name} must be a whole number between ${min} and ${max}`);
  }
  return number;
}

function readTokens(env) {
  return String(env.PIXELWAR_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseOptions(argv, env = {}) {
  const raw = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name !== "url" && !Object.hasOwn(DEFAULTS, name)) throw new UsageError(`unknown option: ${arg}`);
    if (i + 1 >= argv.length) throw new UsageError(`${arg} needs a value`);
    raw[name] = argv[i + 1];
    i += 1;
  }

  if (!raw.url) throw new UsageError("--url is required");
  let url;
  try {
    url = new URL(raw.url);
  } catch {
    throw new UsageError("--url must be a full URL, e.g. https://<gateway host>/api");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new UsageError("--url must use https (tokens must not travel in clear text)");
  }

  const route = raw.route ?? DEFAULTS.route;
  if (!Object.hasOwn(ROUTES, route)) throw new UsageError("--route must be pixel or brush");

  const tokens = readTokens(env);
  if (tokens.length === 0) throw new UsageError("set PIXELWAR_TOKENS to one or more Discord access tokens, separated by commas");

  const x = wholeNumber("x", raw.x ?? DEFAULTS.x, 0, GRID - 1);
  const y = wholeNumber("y", raw.y ?? DEFAULTS.y, 0, GRID - 1);
  return {
    url: url.href.replace(/\/+$/, ""),
    tokens,
    route,
    requests: wholeNumber("requests", raw.requests ?? DEFAULTS.requests, 1, 1000000),
    concurrency: wholeNumber("concurrency", raw.concurrency ?? DEFAULTS.concurrency, 1, 1000),
    rate: wholeNumber("rate", raw.rate ?? DEFAULTS.rate, 0, 10000),
    size: wholeNumber("size", raw.size ?? DEFAULTS.size, 1, MAX_BRUSH),
    x,
    y,
    width: wholeNumber("width", raw.width ?? DEFAULTS.width, 1, GRID - Math.max(x, y)),
    timeout: wholeNumber("timeout", raw.timeout ?? DEFAULTS.timeout, 1, 120)
  };
}

const newRunId = () => randomBytes(4).toString("hex");

const correlationIdOf = (runId, index) => `load-${runId}-${index}`;

function planDraw(index, options, random = Math.random) {
  const pick = () => Math.floor(random() * options.width);
  const body = {
    x: options.x + pick(),
    y: options.y + pick(),
    color: `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, "0")}`
  };
  if (options.route === "brush") body.size = options.size;
  return {
    url: `${options.url}${ROUTES[options.route]}`,
    token: options.tokens[index % options.tokens.length],
    body
  };
}

async function sendDraw(draw, correlationId, { fetch = globalThis.fetch, timeoutSeconds, now = () => performance.now() }) {
  const started = now();
  try {
    const res = await fetch(draw.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${draw.token}`,
        "content-type": "application/json",
        "x-correlation-id": correlationId
      },
      body: JSON.stringify(draw.body),
      signal: AbortSignal.timeout(timeoutSeconds * 1000)
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ms: now() - started, accepted: res.status === 202 ? Number(body?.accepted) || 0 : 0 };
  } catch (error) {
    return { status: error?.name === "TimeoutError" ? "timeout" : "network", ms: now() - started, accepted: 0 };
  }
}

async function runLoad({ requests, concurrency, rate = 0, send, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => performance.now(), onResult = () => {} }) {
  const results = new Array(requests);
  const start = now();
  let next = 0;

  async function lane() {
    while (next < requests) {
      const index = next;
      next += 1;
      if (rate > 0) {
        const wait = start + (index * 1000) / rate - now();
        if (wait > 0) await sleep(wait);
      }
      results[index] = await send(index);
      onResult(results[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, lane));
  return { results, elapsedMs: now() - start };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function summarize(results, elapsedMs) {
  const byStatus = {};
  for (const { status } of results) byStatus[status] = (byStatus[status] ?? 0) + 1;
  const times = results.map((result) => result.ms).sort((a, b) => a - b);
  const seconds = elapsedMs / 1000;
  return {
    total: results.length,
    queued: byStatus[202] ?? 0,
    pixels: results.reduce((sum, result) => sum + result.accepted, 0),
    byStatus,
    seconds,
    perSecond: seconds > 0 ? results.length / seconds : 0,
    latency: {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: times.at(-1) ?? 0
    }
  };
}

function loggingFilter(runId) {
  return `jsonPayload.correlation_id=~"^load-${runId}-"`;
}

const ms = (value) => `${Math.round(value)} ms`;

function report(summary, runId) {
  const statuses = Object.entries(summary.byStatus)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  return [
    `run id:        ${runId}`,
    `draws sent:    ${summary.total} in ${summary.seconds.toFixed(1)} s (${summary.perSecond.toFixed(1)} per second)`,
    `queued (202):  ${summary.queued}, ${summary.pixels} pixels accepted`,
    `statuses:      ${statuses}`,
    `latency:       p50 ${ms(summary.latency.p50)}, p95 ${ms(summary.latency.p95)}, p99 ${ms(summary.latency.p99)}, max ${ms(summary.latency.max)}`,
    `logs filter:   ${loggingFilter(runId)}`
  ].join("\n");
}

module.exports = {
  parseOptions,
  planDraw,
  sendDraw,
  runLoad,
  percentile,
  summarize,
  report,
  loggingFilter,
  newRunId,
  correlationIdOf,
  UsageError,
  USAGE,
  DEFAULTS
};
