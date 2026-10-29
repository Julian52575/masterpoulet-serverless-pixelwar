const http = require("node:http");
const { Firestore } = require("@google-cloud/firestore");
const { createWorker } = require("./worker");
const { createHandlers } = require("./handlers");
const { createCanvasState } = require("./state");
const { createAuthorizer } = require("./authz");
const { createDiscordClient } = require("./discord");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const PORT = Number(process.env.PORT || 8080);

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  process.exit(1);
}
for (const warning of config.warnings) log.warn("configuration warning", { warning });

const discord = createDiscordClient();
const state = createCanvasState({ db: new Firestore() });

const handle = createWorker({
  handlers: createHandlers({ state, discord }),
  authorizer: createAuthorizer(config),
  discord
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
      const { statusCode } = await handle(Buffer.concat(chunks));
      res.writeHead(statusCode);
      res.end();
    } catch (error) {
      log.error("unhandled worker error", { error: error.message });
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
  log.info("command worker listening", { port: server.address().port });
});
