const functions = require("@google-cloud/functions-framework");
const { Storage } = require("@google-cloud/storage");
const { createNotifier } = require("./notifier");
const { createSnapshotFiles } = require("./links");
const { createDiscordClient, createChannelWebhook } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const storage = new Storage(config.storageEndpoint ? { apiEndpoint: config.storageEndpoint } : {});

const handle = createNotifier({
  files: createSnapshotFiles({ bucket: storage.bucket(config.bucket) }),
  discord: createDiscordClient(),
  bucket: config.bucket,
  ttlMinutes: config.ttlMinutes,
  webhook: config.webhookUrl ? createChannelWebhook({ url: config.webhookUrl }) : null,
  postEveryMinutes: config.postEveryMinutes
});

functions.http("snapshotNotifier", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  try {
    const { statusCode } = await handle(req.headers, req.rawBody ?? Buffer.alloc(0));
    res.status(statusCode).end();
  } catch (error) {
    log.error("unhandled notifier error", { error: error.message });
    res.status(500).end();
  }
});
