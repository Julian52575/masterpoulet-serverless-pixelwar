const http = require("node:http");
const { PrismaClient } = require("@prisma/client");
const { createApp } = require("./app");
const { initEvents } = require("./events");
const { createWorker } = require("./worker");
const { createStore } = require("./store");
const { parseRateLimit } = require("./env");
const { registry } = require("./metrics");
const { log } = require("./log");

const port = Number(process.env.PORT || 3000);
// Separate port so /metrics is never reachable through the public /api route.
const metricsPort = Number(process.env.METRICS_PORT || 9464);
const { RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_PORT } = process.env;
const amqpUrl = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
const defaultLimit = parseRateLimit(process.env.RATE_LIMIT);
const admins = (process.env.ADMIN_USERS || "").split(",").filter(Boolean);

async function main() {
  const db = new PrismaClient();
  const store = createStore(db, { defaultLimit });
  const server = http.createServer();
  const events = await initEvents({
    server,
    url: amqpUrl,
    handle: createWorker({ db, store, admins }),
  });
  server.on(
    "request",
    createApp({ db, store, publish: events.publish, admins, unlimited: defaultLimit === 0 }),
  );
  server.listen(port, () => log.info("listening", { port }));

  const metricsServer = http.createServer(async (req, res) => {
    if (req.url !== "/metrics") return res.writeHead(404).end();
    res.writeHead(200, { "content-type": registry.contentType }).end(await registry.metrics());
  });
  metricsServer.listen(metricsPort);

  const shutdown = async () => {
    await events.close().catch(() => {});
    metricsServer.close();
    server.close(async () => {
      await db.$disconnect();
      process.exit();
    });
    server.closeAllConnections();
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGUSR2"]) process.on(sig, shutdown);
}

main().catch((err) => {
  log.error("failed to start", { error: err });
  process.exit(1);
});
