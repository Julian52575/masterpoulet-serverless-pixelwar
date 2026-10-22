const express = require("express");
const { z } = require("zod");

const itemSchema = z.object({ title: z.string().trim().min(1).max(200) });

// `db` and `publish` are injected so tests can stub them.
function createApp({ db, publish }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.get("/items", async (req, res) => {
    res.json(await db.item.findMany({ orderBy: { id: "asc" } }));
  });

  app.post("/items", async (req, res) => {
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid item" });
    const item = await db.item.create({ data: parsed.data });
    await publish("item.created", item);
    res.status(201).json(item);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("backend: unhandled error", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp };
