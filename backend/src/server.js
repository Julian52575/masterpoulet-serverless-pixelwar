const http = require("http");
const { PrismaClient } = require("@prisma/client");
const { createApp } = require("./app");
const { initEvents } = require("./events");

const port = Number(process.env.PORT || 3000);
const { RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_PORT } = process.env;
const amqpUrl = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

async function main() {
  const db = new PrismaClient();
  const server = http.createServer();
  const events = await initEvents({ server, url: amqpUrl });
  server.on("request", createApp({ db, publish: events.publish }));
  server.listen(port, () => console.log(`backend: listening on port ${port}`));

  const shutdown = () =>
    server.close(async () => {
      await events.close().catch(() => {});
      await db.$disconnect();
      process.exit();
    });
  for (const sig of ["SIGINT", "SIGTERM", "SIGUSR2"]) process.on(sig, shutdown);
}

main().catch((err) => {
  console.error("backend: failed to start", err);
  process.exit(1);
});
