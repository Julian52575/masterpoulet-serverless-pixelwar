const amqp = require("amqplib");
const { WebSocketServer, WebSocket } = require("ws");

const QUEUE = "pixel.updated";

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

// Pixels are published to RabbitMQ and consumed here to fan out over /ws.
async function initEvents({ server, url }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const conn = await connectWithRetry(url);
  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE);
  await channel.consume(QUEUE, (msg) => {
    if (!msg) return;
    broadcast(wss, msg.content.toString());
    channel.ack(msg);
  });

  const publish = async (type, payload) => {
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify({ type, payload })));
  };
  return { publish, close: () => conn.close() };
}

module.exports = { initEvents };
