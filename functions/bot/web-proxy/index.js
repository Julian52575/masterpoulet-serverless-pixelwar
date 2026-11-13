const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { createHandler } = require("./handler");
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

functions.http("webProxy", async (req, res) => {
  try {
    const result = await handle({
      method: req.method,
      path: req.path,
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.alloc(0)
    });
    res.status(result.statusCode).set(result.headers).send(result.body);
  } catch (error) {
    log.error("unhandled web proxy error", { error: error.message });
    res.status(500).json({ error: "internal error" });
  }
});
