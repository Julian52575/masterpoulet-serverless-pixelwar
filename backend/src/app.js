const express = require("express");
const { z } = require("zod");
const { renderPng } = require("./png");

const SIZE = 10000;
const TILE = 256;
const MAX_BRUSH = 16;
const MAX_IMAGE = 2048;
const coord = z.coerce.number().int().min(0).max(SIZE - 1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const author = z.string().trim().min(1).max(64);
const pixelSchema = z.object({ x: coord, y: coord, color, author });
const brushSchema = pixelSchema.extend({
  size: z.coerce.number().int().min(1).max(MAX_BRUSH),
});
const regionSchema = (max) =>
  z.object({
    x: coord.default(0),
    y: coord.default(0),
    w: z.coerce.number().int().min(1).max(max),
    h: z.coerce.number().int().min(1).max(max),
  });

// `db` and `publish` are injected so tests can stub them.
function createApp({ db, publish, admins = [], defaultLimit = 20, now = Date.now }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const state = { paused: false };
  const overrides = new Map();
  const hits = new Map();

  // Sliding one-minute window; a brush costs one hit per pixel and is truncated to the quota.
  // Returns how many of `cost` pixels fit in the quota left (0 = rate limited).
  const consume = (user, cost) => {
    const t = now();
    const recent = (hits.get(user) || []).filter((h) => t - h < 60000);
    const granted = Math.max(0, Math.min(cost, (overrides.get(user) ?? defaultLimit) - recent.length));
    for (let i = 0; i < granted; i++) recent.push(t);
    hits.set(user, recent);
    return granted;
  };

  const requireAdmin = (req, res, next) =>
    admins.includes(req.get("x-user")) ? next() : res.status(403).json({ error: "admin only" });

  const submit = async (res, user, pixels) => {
    if (state.paused) return res.status(423).json({ error: "drawing is paused" });
    const granted = consume(user, pixels.length);
    if (granted === 0) return res.status(429).json({ error: "rate limited" });
    const accepted = pixels.slice(0, granted);
    await publish("pixel.draw", {
      pixels: accepted,
      author: user,
      at: new Date(now()).toISOString(),
    });
    res.status(202).json({ accepted: accepted.length });
  };

  const inRegion = ({ x, y, w, h }) => ({
    where: { x: { gte: x, lt: x + w }, y: { gte: y, lt: y + h } },
  });

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.get("/config", (req, res) =>
    res.json({ size: SIZE, tile: TILE, maxBrush: MAX_BRUSH, paused: state.paused }),
  );

  // Chunked loading: one fixed-size tile per request, cacheable by the client.
  app.get("/tiles/:tx/:ty", async (req, res) => {
    const max = Math.ceil(SIZE / TILE);
    const parsed = z
      .object({ tx: z.coerce.number().int().min(0).lt(max), ty: z.coerce.number().int().min(0).lt(max) })
      .safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: "invalid tile" });
    const { tx, ty } = parsed.data;
    res.json(await db.pixel.findMany(inRegion({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE })));
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
    const { x, y, color: c, author: user } = parsed.data;
    await submit(res, user, [{ x, y, color: c.toLowerCase() }]);
  });

  // Square brush centred on (x, y), clipped to the grid.
  app.post("/brush", async (req, res) => {
    const parsed = brushSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid brush" });
    const { x, y, size, color: c, author: user } = parsed.data;
    const start = -Math.floor((size - 1) / 2);
    const pixels = [];
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        const px = x + start + dx;
        const py = y + start + dy;
        if (px >= 0 && py >= 0 && px < SIZE && py < SIZE) {
          pixels.push({ x: px, y: py, color: c.toLowerCase() });
        }
      }
    }
    await submit(res, user, pixels);
  });

  const image = async (req, res, filename) => {
    const parsed = regionSchema(MAX_IMAGE).safeParse({ w: 512, h: 512, ...req.query });
    if (!parsed.success) return res.status(400).json({ error: "invalid region" });
    const { x, y } = parsed.data;
    const w = Math.min(parsed.data.w, SIZE - x);
    const h = Math.min(parsed.data.h, SIZE - y);
    const pixels = await db.pixel.findMany(inRegion({ x, y, w, h }));
    res.type("png");
    if (filename) res.attachment(filename);
    res.send(renderPng({ ox: x, oy: y, w, h, pixels }));
  };

  app.get("/canvas.png", (req, res) => image(req, res));
  app.get("/snapshot.png", (req, res) =>
    image(req, res, `snapshot-${new Date(now()).toISOString().replace(/[:.]/g, "-")}.png`),
  );

  app.post("/admin/pause", requireAdmin, (req, res) => {
    state.paused = true;
    res.json({ paused: true });
  });

  app.post("/admin/resume", requireAdmin, (req, res) => {
    state.paused = false;
    res.json({ paused: false });
  });

  app.post("/admin/clear", requireAdmin, async (req, res) => {
    await publish("canvas.clear", {});
    res.status(202).json({ accepted: true });
  });

  app.post("/admin/ratelimit", requireAdmin, (req, res) => {
    const parsed = z.object({ user: author, limit: z.coerce.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid ratelimit" });
    overrides.set(parsed.data.user, parsed.data.limit);
    res.json(parsed.data);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("backend: unhandled error", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp };
