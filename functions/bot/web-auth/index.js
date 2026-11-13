const functions = require("@google-cloud/functions-framework");
const { createHandler } = require("./handler");
const { createDiscordOAuth } = require("./oauth");
const { loadConfig } = require("./config");
const { log } = require("./logger");

const config = loadConfig();
if (config.problems.length > 0) {
  for (const problem of config.problems) log.error("invalid configuration", { problem });
  throw new Error("invalid configuration");
}

const handle = createHandler({
  oauth: createDiscordOAuth(config),
  appUrl: config.appUrl
});

functions.http("webAuth", async (req, res) => {
  try {
    const result = await handle({ method: req.method, path: req.path, query: req.query, headers: req.headers });
    res.status(result.statusCode).set(result.headers).send(result.body);
  } catch (error) {
    log.error("unhandled web auth error", { error: error.message });
    res.status(500).set("cache-control", "no-store").send("Internal Server Error");
  }
});
