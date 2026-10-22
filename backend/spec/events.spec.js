jest.mock("amqplib");
const mockClient = { terminate: jest.fn() };
jest.mock("ws", () => ({
  WebSocketServer: jest.fn(() => ({ clients: [mockClient], close: jest.fn() })),
  WebSocket: {},
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

async function setup(handle) {
  const ch = fakeChannel();
  amqp.connect.mockResolvedValue({ on: jest.fn(), createChannel: async () => ch, close: jest.fn() });
  const events = await initEvents({ server: {}, url: "amqp://x", handle });
  const commands = ch.consume.mock.calls.find(([q]) => q === "pixelwar.commands.fifo")[1];
  return { ch, commands, events };
}

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
});
