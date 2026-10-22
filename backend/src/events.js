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
  let conn;
  let channel;
  let closing = false;

  // A broker error must not kill the process: log it and reconnect.
  const open = async () => {
    conn = await connectWithRetry(url);
    conn.on("error", (err) => console.error("backend: amqp connection error:", err.message));
    conn.on("close", () => {
      if (closing) return;
      channel = undefined;
      setTimeout(() => open().catch(fatal), 1000);
    });
    const ch = await conn.createChannel();
    ch.on("error", (err) => console.error("backend: amqp channel error:", err.message));
    // Channels close on protocol errors; dropping the connection triggers a clean reconnect.
    ch.on("close", () => !closing && conn.close().catch(() => {}));

    await ch.assertExchange(EVENTS, "fanout", { durable: false });
    const { queue } = await ch.assertQueue("", { exclusive: true });
    await ch.bindQueue(queue, EVENTS, "");
    await ch.consume(queue, (msg) => msg && broadcast(wss, msg.content.toString()), { noAck: true });

    await ch.assertQueue(COMMANDS);
    await ch.prefetch(16);
    await ch.consume(COMMANDS, async (msg) => {
      if (!msg) return;
      try {
        const { type, payload } = JSON.parse(msg.content.toString());
        const event = await handle(type, payload);
        if (event) ch.publish(EVENTS, "", Buffer.from(JSON.stringify(event)));
        ch.ack(msg);
      } catch (err) {
        console.error("backend: worker failed", err);
        ch.nack(msg, false, false);
      }
    });
    channel = ch;
  };

  const fatal = (err) => {
    console.error("backend: lost the broker", err);
    process.exit(1);
  };

  await open();

  const publish = async (type, payload) => {
    if (!channel) throw new Error("broker unavailable");
    channel.sendToQueue(COMMANDS, Buffer.from(JSON.stringify({ type, payload })));
  };
  const close = async () => {
    closing = true;
    await conn.close();
  };
  return { publish, close };
}

module.exports = { initEvents };
