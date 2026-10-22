const express = require("express");
const { z } = require("zod");

const SIZE = 10000;
const coord = z.coerce.number().int().min(0).max(SIZE - 1);
const pixelSchema = z.object({
  x: coord,
  y: coord,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  author: z.string().trim().min(1).max(64),
});
const regionSchema = z.object({
  x: coord,
  y: coord,
  w: z.coerce.number().int().min(1).max(512),
  h: z.coerce.number().int().min(1).max(512),
});

// `db` and `publish` are injected so tests can stub them.
function createApp({ db, publish, maxPerMinute = 30, now = Date.now }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const hits = new Map();
  const allowed = (author) => {
    const t = now();
    const recent = (hits.get(author) || []).filter((h) => t - h < 60000);
    if (recent.length >= maxPerMinute) return false;
    recent.push(t);
    hits.set(author, recent);
    return true;
  };

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.get("/config", (req, res) => res.json({ size: SIZE }));

  // Viewport loading: only the pixels inside the requested rectangle.
  app.get("/pixels", async (req, res) => {
    const parsed = regionSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid region" });
    const { x, y, w, h } = parsed.data;
    res.json(
      await db.pixel.findMany({
        where: { x: { gte: x, lt: x + w }, y: { gte: y, lt: y + h } },
      }),
    );
  });

  app.get("/pixels/:x/:y", async (req, res) => {
    const parsed = z.object({ x: coord, y: coord }).safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: "invalid coordinates" });
    const pixel = await db.pixel.findUnique({ where: { x_y: parsed.data } });
    if (!pixel) return res.status(404).json({ error: "not found" });
    res.json(pixel);
  });

  app.post("/pixels", async (req, res) => {
    const parsed = pixelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid pixel" });
    const { x, y, color, author } = parsed.data;
    if (!allowed(author)) return res.status(429).json({ error: "rate limited" });
    const data = { color: color.toLowerCase(), author };
    const pixel = await db.pixel.upsert({
      where: { x_y: { x, y } },
      create: { x, y, ...data },
      update: data,
    });
    await publish("pixel.updated", pixel);
    res.status(201).json(pixel);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("backend: unhandled error", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp };
