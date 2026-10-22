const { createWorker } = require("../src/worker");

function setup({ paused = false } = {}) {
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(5000),
    $queryRaw: jest.fn(async () => [{ x: 1, y: 2, color: "#000000", author: "bob", updatedAt: "t" }]),
    pixel: {
      deleteMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _min: { x: null, y: null }, _max: { x: null, y: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    snapshot: { create: jest.fn() },
  };
  const store = {
    isPaused: jest.fn().mockResolvedValue(paused),
    setPaused: jest.fn(),
    setLimit: jest.fn(),
    refund: jest.fn().mockResolvedValue(),
  };
  return { db, store, handle: createWorker({ db, store, admins: ["root"] }) };
}

const job = {
  rect: { x0: 1, y0: 2, x1: 2, y1: 3 },
  count: 1,
  color: "#000000",
  author: "bob",
  at: "t",
  minute: 7,
};

describe("worker", () => {
  it("writes a stroke and returns only the changed pixels", async () => {
    const { handle, db } = setup();
    const event = await handle("pixel.draw", job);
    expect(event.type).toBe("pixels.updated");
    expect(event.payload).toHaveLength(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("announces a large stroke as a rectangle to refetch", async () => {
    const { handle, db } = setup();
    const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const event = await handle("pixel.draw", { ...job, rect, count: 5000 });
    expect(event).toEqual({ type: "tiles.invalidated", payload: rect });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("emits nothing when every pixel was already newer", async () => {
    const { handle, db } = setup();
    db.$queryRaw.mockResolvedValue([]);
    expect(await handle("pixel.draw", job)).toBeNull();
  });

  it("drops and refunds a draw that arrives while paused", async () => {
    const { handle, db, store } = setup({ paused: true });
    expect(await handle("pixel.draw", job)).toBeNull();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(store.refund).toHaveBeenCalledWith("bob", 1, 7);
  });

  it("refunds the quota when the write fails", async () => {
    const { handle, db, store } = setup();
    db.$queryRaw.mockRejectedValue(new Error("db down"));
    await expect(handle("pixel.draw", job)).rejects.toThrow("db down");
    expect(store.refund).toHaveBeenCalledWith("bob", 1, 7);
  });

  it("enforces admin rights itself", async () => {
    const { handle, db } = setup();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await handle("admin.clear", { by: "bob" })).toBeNull();
    expect(db.pixel.deleteMany).not.toHaveBeenCalled();
  });

  it("runs admin commands and announces them", async () => {
    const { handle, db, store } = setup();
    expect((await handle("admin.pause", { by: "root" })).type).toBe("canvas.paused");
    expect(store.setPaused).toHaveBeenCalledWith(true);
    expect((await handle("admin.resume", { by: "root" })).type).toBe("canvas.resumed");
    expect((await handle("admin.clear", { by: "root" })).type).toBe("canvas.cleared");
    expect(db.pixel.deleteMany).toHaveBeenCalled();
    expect(await handle("admin.ratelimit", { by: "root", user: "bob", limit: 3 })).toBeNull();
    expect(store.setLimit).toHaveBeenCalledWith("bob", 3);
  });

  it("stores a timestamped snapshot and announces its URL", async () => {
    const { handle, db } = setup();
    const event = await handle("snapshot.requested", { at: "1970-01-01T00:00:00.000Z" });
    const name = "snapshot-1970-01-01T00-00-00-000Z.png";
    expect(event).toEqual({ type: "snapshot.ready", payload: { name, url: `/api/snapshots/${name}` } });
    expect(db.snapshot.create.mock.calls[0][0].data.name).toBe(name);
  });
});
