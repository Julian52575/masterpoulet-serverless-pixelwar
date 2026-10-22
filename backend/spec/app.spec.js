const request = require("supertest");
const { createApp } = require("../src/app");
const { createWorker } = require("../src/worker");

function setup(opts = {}) {
  const db = {
    pixel: {
      findMany: jest.fn().mockResolvedValue([{ x: 1, y: 2, color: "#ff0000", author: "a" }]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const publish = jest.fn();
  return { db, publish, app: createApp({ db, publish, admins: ["root"], ...opts }) };
}

const px = { x: 3, y: 4, color: "#00FF00", author: "bob" };

describe("pixels", () => {
  it("reports health", async () => {
    const res = await request(setup().app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("queues a draw instead of writing", async () => {
    const { app, publish } = setup();
    const res = await request(app).post("/pixels").send(px);
    expect(res.status).toBe(202);
    expect(publish).toHaveBeenCalledWith(
      "pixel.draw",
      expect.objectContaining({ author: "bob", pixels: [{ x: 3, y: 4, color: "#00ff00" }] }),
    );
  });

  it.each([
    { ...px, color: "red" },
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
});

describe("brush", () => {
  it("draws size*size pixels, clipped at the grid edge", async () => {
    const { app, publish } = setup();
    await request(app).post("/brush").send({ ...px, x: 0, y: 0, size: 3 });
    expect(publish.mock.calls[0][1].pixels).toHaveLength(4);
  });

  it("truncates a brush to the remaining quota instead of rejecting it", async () => {
    const { app, publish } = setup({ defaultLimit: 10 });
    const big = { ...px, x: 5, y: 5, size: 5 };
    expect((await request(app).post("/brush").send(big)).body).toEqual({ accepted: 10 });
    expect(publish.mock.calls[0][1].pixels).toHaveLength(10);
    expect((await request(app).post("/brush").send(big)).status).toBe(429);
  });
});

describe("rate limit and admin", () => {
  it("limits per author and honours overrides", async () => {
    const { app } = setup({ defaultLimit: 1 });
    await request(app).post("/pixels").send(px);
    expect((await request(app).post("/pixels").send(px)).status).toBe(429);
    await request(app).post("/admin/ratelimit").set("x-user", "root").send({ user: "bob", limit: 5 });
    expect((await request(app).post("/pixels").send(px)).status).toBe(202);
  });

  it("does not limit when the default is 0", async () => {
    const { app } = setup({ defaultLimit: 0 });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post("/brush").send({ ...px, size: 16 })).status).toBe(202);
    }
  });

  it("caps the brush at 16 unless the rate limit is disabled", async () => {
    const big = { ...px, x: 0, y: 0, size: 40 };
    expect((await request(setup().app).post("/brush").send(big)).status).toBe(400);
    expect((await request(setup().app).get("/config")).body.maxBrush).toBe(16);
    const open = setup({ defaultLimit: 0 }).app;
    expect((await request(open).post("/brush").send(big)).status).toBe(202);
    expect((await request(open).get("/config")).body.maxBrush).toBe(10000);
  });

  it("refuses admin routes to normal users", async () => {
    const { app } = setup();
    expect((await request(app).post("/admin/pause").set("x-user", "bob")).status).toBe(403);
    expect((await request(app).post("/admin/clear")).status).toBe(403);
  });

  it("rejects draws while paused until resumed", async () => {
    const { app } = setup();
    await request(app).post("/admin/pause").set("x-user", "root");
    expect((await request(app).post("/pixels").send(px)).status).toBe(423);
    expect((await request(app).get("/config")).body.paused).toBe(true);
    await request(app).post("/admin/resume").set("x-user", "root");
    expect((await request(app).post("/pixels").send(px)).status).toBe(202);
  });

  it("queues a clear", async () => {
    const { app, publish } = setup();
    await request(app).post("/admin/clear").set("x-user", "root");
    expect(publish).toHaveBeenCalledWith("canvas.clear", {});
  });
});

describe("images", () => {
  it("renders the canvas as a PNG", async () => {
    const res = await request(setup().app).get("/canvas.png?x=0&y=0&w=8&h=8").buffer();
    expect(res.type).toBe("image/png");
    expect(res.body.subarray(1, 4).toString()).toBe("PNG");
  });

  it("names snapshots with a timestamp", async () => {
    const res = await request(setup({ now: () => 0 }).app).get("/snapshot.png?w=4&h=4");
    expect(res.headers["content-disposition"]).toContain("snapshot-1970-01-01T00-00-00-000Z.png");
  });
});

describe("worker", () => {
  it("upserts drawn pixels and returns the delta", async () => {
    const db = {
      pixel: { upsert: jest.fn((a) => a.create) },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    const event = await createWorker(db)("pixel.draw", {
      pixels: [{ x: 1, y: 2, color: "#000000" }],
      author: "bob",
      at: "t",
    });
    expect(event).toEqual({
      type: "pixels.updated",
      payload: [{ x: 1, y: 2, color: "#000000", author: "bob", updatedAt: "t" }],
    });
  });

  it("clears the grid", async () => {
    const db = { pixel: { deleteMany: jest.fn() } };
    expect((await createWorker(db)("canvas.clear", {})).type).toBe("canvas.cleared");
    expect(db.pixel.deleteMany).toHaveBeenCalled();
  });
});
