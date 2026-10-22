const request = require("supertest");
const { createApp } = require("../src/app");

// In-memory stand-in for the database-backed store.
function fakeStore({ limit = 20 } = {}) {
  const used = new Map();
  return {
    paused: false,
    isPaused: jest.fn(async function () {
      return this.paused;
    }),
    take: jest.fn(async (user, cost) => {
      const granted = Math.max(0, Math.min(cost, limit - (used.get(user) ?? 0)));
      used.set(user, (used.get(user) ?? 0) + granted);
      return { granted, minute: 1 };
    }),
  };
}

function setup({ store = fakeStore(), ...opts } = {}) {
  const db = {
    pixel: {
      findMany: jest.fn().mockResolvedValue([{ x: 1, y: 2, color: "#ff0000", author: "a" }]),
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _min: { x: 1, y: 2 }, _max: { x: 1, y: 2 } }),
    },
    snapshot: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const publish = jest.fn();
  return { db, store, publish, app: createApp({ db, store, publish, admins: ["root"], ...opts }) };
}

const px = { x: 3, y: 4, color: "#00FF00", author: "bob" };

describe("pixels", () => {
  it("reports health", async () => {
    expect((await request(setup().app).get("/health")).body).toEqual({ status: "ok" });
  });

  it("queues a draw instead of writing", async () => {
    const { app, publish } = setup();
    const res = await request(app).post("/pixels").send(px);
    expect(res.status).toBe(202);
    expect(publish).toHaveBeenCalledWith(
      "pixel.draw",
      expect.objectContaining({ author: "bob", minute: 1, pixels: [{ x: 3, y: 4, color: "#00ff00" }] }),
    );
  });

  it("accepts palette names", async () => {
    const { app, publish } = setup();
    await request(app).post("/pixels").send({ ...px, color: "Red" });
    expect(publish.mock.calls[0][1].pixels[0].color).toBe("#e50000");
  });

  it.each([
    { ...px, color: "rouge" },
    { ...px, x: 10000 },
    { ...px, author: " " },
  ])("rejects invalid pixel %#", async (body) => {
    expect((await request(setup().app).post("/pixels").send(body)).status).toBe(400);
  });

  it("serves a tile and rejects one outside the grid", async () => {
    const { app, db } = setup();
    expect((await request(app).get("/tiles/1/0")).body).toHaveLength(1);
    expect(db.pixel.findMany.mock.calls[0][0].where.x).toEqual({ gte: 256, lt: 512 });
    expect((await request(app).get("/tiles/40/0")).status).toBe(400);
  });

  it("inspects a pixel", async () => {
    expect((await request(setup().app).get("/pixels/1/1")).status).toBe(404);
  });

  it("reports pause state and palette in the config", async () => {
    const { app, store } = setup();
    store.paused = true;
    const { body } = await request(app).get("/config");
    expect(body).toMatchObject({ paused: true, maxBrush: 16, palette: { red: "#e50000" } });
  });
});

describe("brush and rate limit", () => {
  it("draws size*size pixels, clipped at the grid edge", async () => {
    const { app, publish } = setup();
    await request(app).post("/brush").send({ ...px, x: 0, y: 0, size: 3 });
    expect(publish.mock.calls[0][1].pixels).toHaveLength(4);
  });

  it("truncates a brush to the remaining quota", async () => {
    const { app, publish } = setup({ store: fakeStore({ limit: 10 }) });
    const big = { ...px, x: 5, y: 5, size: 5 };
    expect((await request(app).post("/brush").send(big)).body).toEqual({ accepted: 10 });
    expect(publish.mock.calls[0][1].pixels).toHaveLength(10);
    expect((await request(app).post("/brush").send(big)).status).toBe(429);
  });

  it("caps the brush at 16 unless the rate limit is disabled", async () => {
    const big = { ...px, x: 0, y: 0, size: 40 };
    expect((await request(setup().app).post("/brush").send(big)).status).toBe(400);
    const open = setup({ unlimited: true, store: fakeStore({ limit: Infinity }) }).app;
    expect((await request(open).post("/brush").send(big)).status).toBe(202);
    expect((await request(open).get("/config")).body.maxBrush).toBe(10000);
  });

  it("rejects draws while paused", async () => {
    const { app, store, publish } = setup();
    store.paused = true;
    expect((await request(app).post("/pixels").send(px)).status).toBe(423);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("admin", () => {
  it("refuses admin routes to normal users", async () => {
    const { app, publish } = setup();
    expect((await request(app).post("/admin/pause").set("x-user", "bob")).status).toBe(403);
    expect((await request(app).post("/admin/clear")).status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(["pause", "resume", "clear"])("queues %s with the caller", async (cmd) => {
    const { app, publish } = setup();
    const res = await request(app).post(`/admin/${cmd}`).set("x-user", "root");
    expect(res.status).toBe(202);
    expect(publish).toHaveBeenCalledWith(`admin.${cmd}`, { by: "root" });
  });

  it("validates and queues a rate limit override", async () => {
    const { app, publish } = setup();
    const send = (body) => request(app).post("/admin/ratelimit").set("x-user", "root").send(body);
    expect((await send({ user: "bob" })).status).toBe(400);
    expect((await send({ user: "bob", limit: 5 })).status).toBe(202);
    expect(publish).toHaveBeenCalledWith("admin.ratelimit", { user: "bob", limit: 5, by: "root" });
  });
});

describe("images", () => {
  it("renders the painted area as a PNG", async () => {
    const { app, db } = setup();
    const res = await request(app).get("/canvas.png").buffer();
    expect(res.type).toBe("image/png");
    expect(res.body.subarray(1, 4).toString()).toBe("PNG");
    expect(db.pixel.findMany.mock.calls[0][0].where.x).toEqual({ gte: 1, lt: 2 });
  });

  it("renders a requested region", async () => {
    const { app, db } = setup();
    await request(app).get("/canvas.png?x=10&y=20&w=8&h=8");
    expect(db.pixel.findMany.mock.calls[0][0].where.y).toEqual({ gte: 20, lt: 28 });
  });

  it("queues a snapshot with a timestamp", async () => {
    const { app, publish } = setup({ now: () => 0 });
    expect((await request(app).post("/snapshots")).status).toBe(202);
    expect(publish).toHaveBeenCalledWith("snapshot.requested", { at: "1970-01-01T00:00:00.000Z" });
  });

  it("serves stored snapshots only by a valid name", async () => {
    const { app, db } = setup();
    expect((await request(app).get("/snapshots/..%2Fsecret")).status).toBe(400);
    expect((await request(app).get("/snapshots/snapshot-x.png")).status).toBe(404);
    db.snapshot.findUnique.mockResolvedValue({ png: Buffer.from("png") });
    const res = await request(app).get("/snapshots/snapshot-x.png");
    expect(res.headers["content-disposition"]).toContain("snapshot-x.png");
  });
});
