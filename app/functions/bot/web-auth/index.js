const { startTracing, flushTraces, inSpan, recordStatus, SpanKind } = require("./tracing");

startTracing({ service: "web-auth" });

const functions = require("@google-cloud/functions-framework");
const { createHandler, routeOf } = require("./handler");
const { createDiscordOAuth } = require("./oauth");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const handle = createHandler({
  oauth: createDiscordOAuth(config),
  appUrl: config.appUrl
});

const INTERNAL_ERROR = { statusCode: 500, headers: { "cache-control": "no-store" }, body: "Internal Server Error" };

functions.http("webAuth", async (req, res) => {
  const route = routeOf(req.path) ?? "unknown";
  const span = { kind: SpanKind.SERVER, parent: req.headers, attributes: { "http.request.method": req.method, "http.route": route } };
  const result = await inSpan(`web-auth ${route}`, span, async (server) => {
    let answer = INTERNAL_ERROR;
    try {
      answer = await handle({ method: req.method, path: req.path, query: req.query, headers: req.headers });
    } catch (error) {
      log.error("unhandled web auth error", { error: error.message });
    }
    recordStatus(server, answer.statusCode);
    return answer;
  });
  await flushTraces();
  res.status(result.statusCode).set(result.headers).send(result.body);
});
