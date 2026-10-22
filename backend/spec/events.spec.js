jest.mock("amqplib");
const mockClient = { terminate: jest.fn() };
jest.mock("ws", () => ({
  WebSocketServer: jest.fn(() => ({ clients: [mockClient], close: jest.fn() })),
  WebSocket: { OPEN: 1 },
}));
const amqp = require("amqplib");
const { initEvents } = require("../src/events");

function fakeChannel() {
  return {
    on: jest.fn(),
    assertExchange: jest.fn(),
    assertQueue: jest.fn(async (name) => ({ queue: name || "events" })),
    bindQueue: jest.fn(),
    consume: jest.fn(),
    prefetch: jest.fn(),
    publish: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(),
  };
}

function fakeConnection(ch) {
  const handlers = {};
  return {
    handlers,
    on: jest.fn((event, fn) => (handlers[event] = fn)),
    createChannel: async () => ch,
    close: jest.fn().mockResolvedValue(),
  };
}

async function setup(handle) {
  const ch = fakeChannel();
  const conn = fakeConnection(ch);
  amqp.connect.mockResolvedValue(conn);
  const events = await initEvents({ server: {}, url: "amqp://x", handle });
  const consumer = (q) => ch.consume.mock.calls.find(([name]) => name === q)[1];
  return { ch, conn, events, commands: consumer("pixelwar.commands.fifo"), relay: consumer("events") };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.readyState = 1;
  mockClient.send = jest.fn();
});

const msg = (type) => ({ content: Buffer.from(JSON.stringify({ type, payload: {} })) });

describe("events", () => {
  it("consumes commands one at a time through a single active consumer", async () => {
    const { ch } = await setup(jest.fn());
    expect(ch.prefetch).toHaveBeenCalledWith(1);
    expect(ch.assertQueue).toHaveBeenCalledWith("pixelwar.commands.fifo", {
      arguments: { "x-single-active-consumer": true },
    });
  });

  it("publishes the event before acking the command", async () => {
    const order = [];
    const { ch, commands } = await setup(async (type) => ({ type: `${type}.done` }));
    ch.publish.mockImplementation(() => order.push("publish"));
    ch.ack.mockImplementation(() => order.push("ack"));
    await commands(msg("pixel.draw"));
    expect(order).toEqual(["publish", "ack"]);
  });

  it("terminates WebSocket clients on close so shutdown cannot hang", async () => {
    const { events } = await setup(jest.fn());
    await events.close();
    expect(mockClient.terminate).toHaveBeenCalled();
  });

  it("relays broker events to open WebSocket clients", async () => {
    const { relay } = await setup(jest.fn());
    relay({ content: Buffer.from('{"type":"x"}') });
    expect(mockClient.send).toHaveBeenCalledWith('{"type":"x"}');
  });

  it("skips publishing when the worker has nothing to announce", async () => {
    const { ch, commands } = await setup(async () => null);
    await commands(msg("admin.ratelimit"));
    expect(ch.publish).not.toHaveBeenCalled();
    expect(ch.ack).toHaveBeenCalled();
  });

  it("parks a command whose handler fails in the dead-letter queue without crashing", async () => {
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { ch, commands } = await setup(async () => {
      throw new Error("boom");
    });
    const failed = { ...msg("pixel.draw"), properties: { correlationId: "abc-123" } };
    await commands(failed);
    expect(ch.sendToQueue).toHaveBeenCalledWith("pixelwar.commands.dlq", failed.content, {
      persistent: true,
      correlationId: "abc-123",
      headers: { "x-error": "boom" },
    });
    expect(ch.ack).toHaveBeenCalledWith(failed);
  });

  it("queues published commands", async () => {
    const { ch, events } = await setup(jest.fn());
    await events.publish("pixel.draw", { a: 1 }, { correlationId: "abc-123" });
    expect(ch.sendToQueue.mock.calls[0][0]).toBe("pixelwar.commands.fifo");
    expect(JSON.parse(ch.sendToQueue.mock.calls[0][1])).toEqual({ type: "pixel.draw", payload: { a: 1 } });
    expect(ch.sendToQueue.mock.calls[0][2]).toEqual({
      persistent: true,
      correlationId: "abc-123",
      timestamp: expect.any(Number),
    });
  });

  it("reconnects after the broker connection drops", async () => {
    jest.useFakeTimers();
    try {
      const { conn, events } = await setup(jest.fn());
      conn.handlers.close();
      await expect(events.publish("pixel.draw", {})).rejects.toThrow("broker unavailable");
      await jest.advanceTimersByTimeAsync(1000);
      expect(amqp.connect).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
