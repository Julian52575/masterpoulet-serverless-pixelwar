const amqp = require("amqplib");
const { WebSocketServer, WebSocket } = require("ws");
const { log } = require("./log");
const metrics = require("./metrics");

// Renamed from "pixelwar.commands": a queue's arguments cannot change once declared.
const COMMANDS = "pixelwar.commands.fifo";
const EVENTS = "pixelwar.events";
// Failed commands are parked here instead of dropped, so they can be counted, alerted on and replayed.
const DLQ = "pixelwar.commands.dlq";

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
    conn.on("error", (err) => log.error("amqp connection error", { error: err.message }));
    conn.on("close", () => {
      if (closing) return;
      channel = undefined;
      setTimeout(() => open().catch(fatal), 1000);
    });
    const ch = await conn.createChannel();
    ch.on("error", (err) => log.error("amqp channel error", { error: err.message }));
    // Channels close on protocol errors; dropping the connection triggers a clean reconnect.
    ch.on("close", () => !closing && conn.close().catch(() => {}));

    await ch.assertExchange(EVENTS, "fanout", { durable: false });
    const { queue } = await ch.assertQueue("", { exclusive: true });
    await ch.bindQueue(queue, EVENTS, "");
    await ch.consume(queue, (msg) => msg && broadcast(wss, msg.content.toString()), { noAck: true });

    // First in, first served: one consumer across all instances, one unacked command at a time,
    // and the event is published before the ack, so events leave in command order.
    await ch.assertQueue(COMMANDS, { arguments: { "x-single-active-consumer": true } });
    await ch.prefetch(1);
    await ch.assertQueue(DLQ, { durable: true });
    await ch.consume(COMMANDS, async (msg) => {
      if (!msg) return;
      const correlationId = msg.properties?.correlationId;
      let type = "unknown";
      try {
        const command = JSON.parse(msg.content.toString());
        type = command.type;
        const sentAt = msg.properties?.timestamp;
        if (sentAt) metrics.commandWait.observe({ type }, Math.max(0, Date.now() - sentAt) / 1000);
        const end = metrics.commandDuration.startTimer({ type });
        const event = await handle(type, command.payload);
        end();
        if (event) ch.publish(EVENTS, "", Buffer.from(JSON.stringify(event)), { correlationId });
        ch.ack(msg);
        metrics.commands.inc({ type, outcome: "ok" });
        log.info("command processed", { correlation_id: correlationId, event_type: type, user_id: command.payload?.author });
      } catch (err) {
        log.error("command failed", { correlation_id: correlationId, event_type: type, error: err });
        metrics.commands.inc({ type, outcome: "failed" });
        // Ack only once the copy is parked, so a failure here still loses nothing silently.
        ch.sendToQueue(DLQ, msg.content, {
          persistent: true,
          correlationId,
          headers: { "x-error": String(err?.message ?? err) },
        });
        ch.ack(msg);
      }
    });
    channel = ch;
  };

  const fatal = (err) => {
    log.error("lost the broker", { error: err });
    process.exit(1);
  };

  await open();

  const publish = async (type, payload, { correlationId } = {}) => {
    if (!channel) throw new Error("broker unavailable");
    // Persistent so accepted draws survive a broker restart before the worker writes them.
    channel.sendToQueue(COMMANDS, Buffer.from(JSON.stringify({ type, payload })), {
      persistent: true,
      correlationId,
      // Lets the worker measure how long the command waited in the queue.
      timestamp: Date.now(),
    });
  };
  // Open WebSockets would otherwise keep server.close() waiting forever.
  const close = async () => {
    closing = true;
    for (const client of wss.clients) client.terminate();
    wss.close();
    await conn.close();
  };
  return { publish, close };
}

module.exports = { initEvents };
