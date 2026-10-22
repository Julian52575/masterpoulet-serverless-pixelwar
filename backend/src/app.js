const express = require("express");
const { z } = require("zod");
const { SIZE, TILE, MAX_BRUSH, MAX_IMAGE } = require("./grid");
const { PALETTE, colorSchema } = require("./palette");
const { inRegion, renderGrid } = require("./render");

const coord = z.coerce.number().int().min(0).max(SIZE - 1);
const author = z.string().trim().min(1).max(64);
const pixelSchema = z.object({ x: coord, y: coord, color: colorSchema, author });
const brushSchema = (max) => pixelSchema.extend({ size: z.coerce.number().int().min(1).max(max) });
const regionSchema = z.object({
  x: coord.default(0),
  y: coord.default(0),
  w: z.coerce.number().int().min(1).max(MAX_IMAGE).default(512),
  h: z.coerce.number().int().min(1).max(MAX_IMAGE).default(512),
});
const tileIndex = z.coerce.number().int().min(0).lt(Math.ceil(SIZE / TILE));

// The API is the proxy: it validates, applies pause and quota, and queues the work.
// `db`, `store` and `publish` are injected so tests can stub them.
function createApp({ db, store, publish, admins = [], unlimited = false, now = Date.now }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // Without a rate limit nothing else bounds a brush, so only the grid does.
  const maxBrush = unlimited ? SIZE : MAX_BRUSH;

  // A stroke is queued as a rectangle plus a pixel count, never as a pixel list,
  // so the message stays tiny whatever the brush size.
  const submit = async (res, user, rect, color) => {
    if (await store.isPaused()) return res.status(423).json({ error: "drawing is paused" });
    const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
    const { granted, minute } = await store.take(user, area);
    if (granted === 0) return res.status(429).json({ error: "rate limited" });
    await publish("pixel.draw", {
      rect,
      count: granted,
      color,
      author: user,
      at: new Date(now()).toISOString(),
      minute,
    });
    res.status(202).json({ accepted: granted });
  };

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.get("/config", async (req, res) =>
    res.json({ size: SIZE, tile: TILE, maxBrush, paused: await store.isPaused(), palette: PALETTE }),
  );

  // Chunked loading: one fixed-size tile per request.
  app.get("/tiles/:tx/:ty", async (req, res) => {
    const parsed = z.object({ tx: tileIndex, ty: tileIndex }).safeParse(req.params);
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
    const { x, y, color, author: user } = parsed.data;
    await submit(res, user, { x0: x, y0: y, x1: x + 1, y1: y + 1 }, color);
  });

  // Square brush centred on (x, y), clipped to the grid; truncated to the remaining quota.
  app.post("/brush", async (req, res) => {
    const parsed = brushSchema(maxBrush).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid brush" });
    const { x, y, size, color, author: user } = parsed.data;
    const start = -Math.floor((size - 1) / 2);
    const rect = {
      x0: Math.max(0, x + start),
      y0: Math.max(0, y + start),
      x1: Math.min(SIZE, x + start + size),
      y1: Math.min(SIZE, y + start + size),
    };
    await submit(res, user, rect, color);
  });

  // Current state as a PNG: the painted area, or the requested region.
  app.get("/canvas.png", async (req, res) => {
    let region;
    if (["x", "y", "w", "h"].some((k) => k in req.query)) {
      const parsed = regionSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "invalid region" });
      region = parsed.data;
    }
    res.type("png").send(await renderGrid(db, { size: SIZE, max: MAX_IMAGE, region }));
  });

  // Rendered by the worker, which announces `snapshot.ready` with the download URL.
  app.post("/snapshots", async (req, res) => {
    await publish("snapshot.requested", { at: new Date(now()).toISOString() });
    res.status(202).json({ accepted: true });
  });

  app.get("/snapshots/:name", async (req, res) => {
    const name = req.params.name;
    if (!/^snapshot-[\w-]+\.png$/.test(name)) return res.status(400).json({ error: "invalid name" });
    const snapshot = await db.snapshot.findUnique({ where: { name } });
    if (!snapshot) return res.status(404).json({ error: "not found" });
    res.type("png").attachment(name).send(Buffer.from(snapshot.png));
  });

  const admin = (type, schema = z.object({})) => async (req, res) => {
    const by = req.get("x-user");
    if (!admins.includes(by)) return res.status(403).json({ error: "admin only" });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid command" });
    await publish(type, { ...parsed.data, by });
    res.status(202).json({ accepted: true });
  };

  app.post("/admin/pause", admin("admin.pause"));
  app.post("/admin/resume", admin("admin.resume"));
  app.post("/admin/clear", admin("admin.clear"));
  app.post(
    "/admin/ratelimit",
    admin("admin.ratelimit", z.object({ user: author, limit: z.coerce.number().int().min(0) })),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("backend: unhandled error", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp };
