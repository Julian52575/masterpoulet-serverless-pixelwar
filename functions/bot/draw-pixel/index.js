const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { PubSub } = require("@google-cloud/pubsub");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");
const { createRateLimits } = require("./limits");
const { createPixelStore } = require("./pixels");
const { createPixelEvents } = require("./events");
const { createDiscordClient } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const db = new Firestore();

const handle = createWorker({
  handlers: createHandlers({
    limits: createRateLimits({ db }),
    pixels: createPixelStore({ db }),
    events: createPixelEvents({ topic: new PubSub().topic(config.pixelEventsTopic) }),
    discord: createDiscordClient()
  })
});

functions.http("drawPixel", async (req, res) => {
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
