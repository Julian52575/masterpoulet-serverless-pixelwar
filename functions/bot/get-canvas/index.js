const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");
const { createCanvasReader } = require("./canvas");
const { createCanvasView } = require("./view");
const { createSnapshotReader } = require("./bucket");
const { createDiscordClient } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const storage = new Storage(config.storageEndpoint ? { apiEndpoint: config.storageEndpoint } : {});

const handle = createWorker({
  handlers: createHandlers({
    view: createCanvasView({
      canvas: createCanvasReader({ db: new Firestore() }),
      store: createSnapshotReader({ bucket: storage.bucket(config.bucket) })
    }),
    discord: createDiscordClient()
  })
});

functions.http("getCanvas", async (req, res) => {
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
