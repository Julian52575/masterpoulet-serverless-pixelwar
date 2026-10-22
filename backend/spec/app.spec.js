const request = require("supertest");
const { createApp } = require("../src/app");

function setup() {
  const db = {
    item: {
      findMany: jest.fn().mockResolvedValue([{ id: 1, title: "a" }]),
      create: jest.fn(async ({ data }) => ({ id: 2, ...data })),
    },
  };
  const publish = jest.fn();
  return { db, publish, app: createApp({ db, publish }) };
}

describe("backend", () => {
  it("reports health", async () => {
    const res = await request(setup().app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("lists items", async () => {
    const res = await request(setup().app).get("/items");
    expect(res.body).toEqual([{ id: 1, title: "a" }]);
  });

  it("creates an item and publishes an event", async () => {
    const { app, publish } = setup();
    const res = await request(app).post("/items").send({ title: "b" });
    expect(res.status).toBe(201);
    expect(publish).toHaveBeenCalledWith("item.created", { id: 2, title: "b" });
  });

  it("rejects an empty title", async () => {
    const res = await request(setup().app).post("/items").send({ title: " " });
    expect(res.status).toBe(400);
  });
});
