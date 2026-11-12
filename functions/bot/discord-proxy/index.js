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

  try {
    const result = await handler({
      headers: req.headers,
      body: (req.rawBody ?? Buffer.alloc(0)).toString("base64"),
      isBase64Encoded: true
    });

    res.status(result.statusCode || 500).set(result.headers || {}).send(result.body || "");
  } catch (error) {
    log.error("unhandled proxy error", { error: error.message });
    res.status(500).type("text/plain").send("Internal Server Error");
  }
});
