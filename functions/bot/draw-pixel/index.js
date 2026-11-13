const { startTracing, flushTraces } = require("./tracing");

startTracing({ service: "draw-pixel" });

const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");
const { createRateLimits } = require("./limits");
const { createPixelStore } = require("./pixels");
const { createDiscordClient } = require("./discord");
const { log } = require("./logger");

const db = new Firestore();

const handle = createWorker({
  handlers: createHandlers({
    limits: createRateLimits({ db }),
    pixels: createPixelStore({ db }),
    discord: createDiscordClient()
  })
});

functions.http("drawPixel", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  let statusCode = 500;
  try {
    ({ statusCode } = await handle(req.rawBody ?? Buffer.alloc(0)));
  } catch (error) {
    log.error("unhandled worker error", { error: error.message });
  }
  await flushTraces();
  res.status(statusCode).end();
});
