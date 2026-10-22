const amqp = require("amqplib");
const { WebSocketServer, WebSocket } = require("ws");

const COMMANDS = "pixelwar.commands";
const EVENTS = "pixelwar.events";

function broadcast(wss, message) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// RabbitMQ may still be starting even after its healthcheck passes.
async function connectWithRetry(url, attempts = 10) {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(url);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// API -> command queue -> worker (`handle`) -> events exchange -> every instance's /ws clients.
// Commands are shared between instances; events are fanned out so every client sees them.
async function initEvents({ server, url, handle }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conn = await connectWithRetry(url);
  const channel = await conn.createChannel();

  await channel.assertExchange(EVENTS, "fanout", { durable: false });
  const { queue } = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(queue, EVENTS, "");
  await channel.consume(queue, (msg) => msg && broadcast(wss, msg.content.toString()), {
    noAck: true,
  });

  await channel.assertQueue(COMMANDS);
  await channel.prefetch(16);
  await channel.consume(COMMANDS, async (msg) => {
    if (!msg) return;
    try {
      const { type, payload } = JSON.parse(msg.content.toString());
      const event = await handle(type, payload);
      if (event) channel.publish(EVENTS, "", Buffer.from(JSON.stringify(event)));
      channel.ack(msg);
    } catch (err) {
      console.error("backend: worker failed", err);
      channel.nack(msg, false, false);
    }
  });

  const publish = async (type, payload) => {
    channel.sendToQueue(COMMANDS, Buffer.from(JSON.stringify({ type, payload })));
  };
  return { publish, close: () => conn.close() };
}

module.exports = { initEvents };
