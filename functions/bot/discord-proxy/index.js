const { startTracing, flushTraces, inSpan, recordStatus, SpanKind } = require("./tracing");

startTracing({ service: "discord-proxy" });

const functions = require("@google-cloud/functions-framework");
const { handler } = require("./handler");
const { checkConfig } = require("./config");
const { log } = require("./logger");

const problems = checkConfig();
if (problems.length > 0) {
  for (const problem of problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

functions.http("discordProxy", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).type("text/plain").send("Method Not Allowed");
    return;
  }

  const span = { kind: SpanKind.SERVER, parent: req.headers, attributes: { "http.request.method": req.method, "http.route": "/interactions" } };
  const result = await inSpan("discord-proxy interaction", span, async (server) => {
    let answer = { statusCode: 500, headers: { "content-type": "text/plain" }, body: "Internal Server Error" };
    try {
      answer = await handler({
        headers: req.headers,
        body: (req.rawBody ?? Buffer.alloc(0)).toString("base64"),
        isBase64Encoded: true
      });
    } catch (error) {
      log.error("unhandled proxy error", { error: error.message });
    }
    recordStatus(server, answer.statusCode || 500);
    return answer;
  });
  await flushTraces();
  res.status(result.statusCode || 500).set(result.headers || {}).send(result.body || "");
});
