const http = require("node:http");
const { handler } = require("./handler");

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/interactions") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not Found");
    return;
  }

  let rawBody = "";
  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    rawBody += chunk;
  });

  req.on("end", async () => {
    try {
      const result = await handler({
        version: "2.0",
        routeKey: "POST /interactions",
        rawPath: "/interactions",
        headers: req.headers,
        body: rawBody,
        isBase64Encoded: false
      });

      res.writeHead(result.statusCode || 500, result.headers || {});
      res.end(result.body || "");
    } catch (error) {
      console.error("Proxy error:", error);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  req.on("error", (error) => {
    console.error("Request error:", error);
    if (!res.headersSent) res.writeHead(400);
    res.end("Bad Request");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Discord proxy local: http://127.0.0.1:${PORT}/interactions`);
});
