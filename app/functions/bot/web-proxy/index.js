const { startTracing, flushTraces, inSpan, recordStatus, SpanKind } = require("./tracing");

startTracing({ service: "web-proxy" });

const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { createHandler } = require("./handler");
const { routeOf } = require("./draws");
const { createDiscordAuth } = require("./auth");
const { createQuota } = require("./quota");
const { createPublisher } = require("./publisher");
const { checkConfig } = require("./config");
const { log } = require("./logger");

const problems = checkConfig();
if (problems.length > 0) {
  for (const problem of problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const handle = createHandler({
  authenticate: createDiscordAuth().authenticate,
  quota: createQuota({ db: new Firestore() }),
  publish: createPublisher()
});

const INTERNAL_ERROR = { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "internal error" }) };

functions.http("webProxy", async (req, res) => {
  const route = routeOf(req.path) ?? "unknown";
  const span = { kind: SpanKind.SERVER, parent: req.headers, attributes: { "http.request.method": req.method, "http.route": route } };
  const result = await inSpan(`web-proxy ${route}`, span, async (server) => {
    let answer = INTERNAL_ERROR;
    try {
      answer = await handle({
        method: req.method,
        path: req.path,
        headers: req.headers,
        rawBody: req.rawBody ?? Buffer.alloc(0)
      });
    } catch (error) {
      log.error("unhandled web proxy error", { error: error.message });
    }
    recordStatus(server, answer.statusCode);
    return answer;
  });
  await flushTraces();
  res.status(result.statusCode).set(result.headers).send(result.body);
});
