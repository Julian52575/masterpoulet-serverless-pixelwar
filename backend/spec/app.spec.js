const request = require("supertest");
const { createApp } = require("../src/app");

function setup(opts = {}) {
  const db = {
    pixel: {
      findMany: jest.fn().mockResolvedValue([{ x: 1, y: 2, color: "#ff0000", author: "a" }]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async ({ create }) => ({ ...create, updatedAt: "t" })),
    },
  };
  const publish = jest.fn();
  return { db, publish, app: createApp({ db, publish, ...opts }) };
}

const px = { x: 3, y: 4, color: "#00FF00", author: "bob" };

describe("backend", () => {
  it("reports health", async () => {
    const res = await request(setup().app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("lists pixels in a region", async () => {
    const { app, db } = setup();
    const res = await request(app).get("/pixels?x=0&y=0&w=10&h=10");
    expect(res.body).toHaveLength(1);
    expect(db.pixel.findMany.mock.calls[0][0].where.x).toEqual({ gte: 0, lt: 10 });
  });

  it("rejects an oversized region", async () => {
    const res = await request(setup().app).get("/pixels?x=0&y=0&w=5000&h=10");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an untouched pixel", async () => {
    const res = await request(setup().app).get("/pixels/1/1");
    expect(res.status).toBe(404);
  });

  it("draws a pixel and publishes an event", async () => {
    const { app, publish } = setup();
    const res = await request(app).post("/pixels").send(px);
    expect(res.status).toBe(201);
    expect(publish).toHaveBeenCalledWith("pixel.updated", expect.objectContaining({ x: 3, y: 4, color: "#00ff00" }));
  });

  it.each([
    { ...px, color: "red" },
    { ...px, x: 10000 },
    { ...px, author: " " },
  ])("rejects invalid pixel %#", async (body) => {
    const res = await request(setup().app).post("/pixels").send(body);
    expect(res.status).toBe(400);
  });

  it("rate limits per author", async () => {
    const { app } = setup({ maxPerMinute: 1 });
    await request(app).post("/pixels").send(px);
    expect((await request(app).post("/pixels").send(px)).status).toBe(429);
    expect((await request(app).post("/pixels").send({ ...px, author: "eve" })).status).toBe(201);
  });
});
