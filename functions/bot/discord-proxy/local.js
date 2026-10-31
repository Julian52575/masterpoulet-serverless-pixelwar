const http = require("node:http");
const { handler } = require("./handler");
const { checkConfig } = require("./config");
const { log } = require("./logger");

const PORT = Number(process.env.PORT || 8080);

const problems = checkConfig();
if (problems.length > 0) {
  for (const problem of problems) log.error("invalid configuration", { problem });
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/interactions") {
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
      const result = await handler({
        version: "2.0",
        routeKey: "POST /interactions",
        rawPath: "/interactions",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("base64"),
        isBase64Encoded: true
      });

      res.writeHead(result.statusCode || 500, result.headers || {});
      res.end(result.body || "");
    } catch (error) {
      log.error("unhandled proxy error", { error: error.message });
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  req.on("error", (error) => {
    log.warn("request stream error", { error: error.message });
    if (!res.headersSent) res.writeHead(400);
    res.end("Bad Request");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log.info("discord proxy listening", { port: PORT });
});
