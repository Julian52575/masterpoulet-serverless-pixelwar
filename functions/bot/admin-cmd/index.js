const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");
const { createCanvasState } = require("./state");
const { createRateLimits } = require("./limits");
const { createCanvasCleaner } = require("./clear");
const { createAuthorizer } = require("./authz");
const { createDiscordClient } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}
for (const warning of config.warnings) log.warn("configuration warning", { warning });

const db = new Firestore();
const discord = createDiscordClient();

const handle = createWorker({
  handlers: createHandlers({
    state: createCanvasState({ db }),
    limits: createRateLimits({ db }),
    cleaner: createCanvasCleaner({ db }),
    discord
  }),
  authorizer: createAuthorizer(config),
  discord
});

functions.http("adminCmd", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  try {
    const { statusCode } = await handle(req.rawBody ?? Buffer.alloc(0));
    res.status(statusCode).end();
  } catch (error) {
    log.error("unhandled worker error", { error: error.message });
    res.status(500).end();
  }
});
