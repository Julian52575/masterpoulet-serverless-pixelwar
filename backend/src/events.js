const amqp = require("amqplib");
const { WebSocketServer, WebSocket } = require("ws");

const QUEUE = "pixelwar.commands";

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

// API -> queue -> worker (`handle`) -> every /ws client.
async function initEvents({ server, url, handle }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conn = await connectWithRetry(url);
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE);
  await channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const { type, payload } = JSON.parse(msg.content.toString());
      const event = await handle(type, payload);
      if (event) broadcast(wss, JSON.stringify(event));
      channel.ack(msg);
    } catch (err) {
      console.error("backend: worker failed", err);
      channel.nack(msg, false, false);
    }
  });

  const publish = async (type, payload) => {
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify({ type, payload })));
  };
  return { publish, close: () => conn.close() };
}

module.exports = { initEvents };
