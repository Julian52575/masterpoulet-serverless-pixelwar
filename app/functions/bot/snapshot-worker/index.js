const { startTracing, flushTraces } = require("./tracing");

startTracing({ service: "snapshot-worker" });

const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { createWorker } = require("./worker");
const { createSnapshotTaker } = require("./snapshot");
const { createCanvasReader } = require("./state");
const { createSnapshotStore } = require("./storage");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const storage = new Storage(config.storageEndpoint ? { apiEndpoint: config.storageEndpoint } : {});

const handle = createWorker({
  takeSnapshot: createSnapshotTaker({
    canvas: createCanvasReader({ db: new Firestore() }),
    store: createSnapshotStore({ bucket: storage.bucket(config.bucket) })
  })
});

functions.http("snapshotWorker", async (req, res) => {
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
