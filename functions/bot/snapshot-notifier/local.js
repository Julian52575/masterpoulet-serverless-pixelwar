const http = require("node:http");
const { Storage } = require("@google-cloud/storage");
const { createNotifier } = require("./notifier");
const { createSnapshotFiles } = require("./links");
const { createDiscordClient } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const PORT = Number(process.env.PORT || 8080);

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  process.exit(1);
}

const storage = new Storage(config.storageEndpoint ? { apiEndpoint: config.storageEndpoint } : {});

const handle = createNotifier({
  files: createSnapshotFiles({ bucket: storage.bucket(config.bucket) }),
  discord: createDiscordClient(),
  bucket: config.bucket,
  ttlMinutes: config.ttlMinutes
});

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not Found");
    return;
  }

  const chunks = [];

  req.on("data", (chunk) => {
    chunks.push(chunk);
  });

  req.on("end", async () => {
    try {
      const { statusCode } = await handle(req.headers, Buffer.concat(chunks));
      res.writeHead(statusCode);
      res.end();
    } catch (error) {
      log.error("unhandled notifier error", { error: error.message });
      res.writeHead(500);
      res.end();
    }
  });

  req.on("error", (error) => {
    log.warn("request stream error", { error: error.message });
    if (!res.headersSent) res.writeHead(400);
    res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log.info("snapshot notifier listening", { port: server.address().port });
});
