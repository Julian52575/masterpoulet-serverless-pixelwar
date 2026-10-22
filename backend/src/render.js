const { renderPng } = require("./png");

const inRegion = ({ x, y, w, h }) => ({
  where: { x: { gte: x, lt: x + w }, y: { gte: y, lt: y + h } },
});

// Without an explicit region, frame the painted area so the image shows the whole drawing.
async function paintedRegion(db) {
  const { _min, _max } = await db.pixel.aggregate({
    _min: { x: true, y: true },
    _max: { x: true, y: true },
  });
  if (_min.x === null) return { x: 0, y: 0, w: 64, h: 64 };
  return { x: _min.x, y: _min.y, w: _max.x - _min.x + 1, h: _max.y - _min.y + 1 };
}

async function renderGrid(db, { size, max, region }) {
  const r = region ?? (await paintedRegion(db));
  const w = Math.max(1, Math.min(r.w, max, size - r.x));
  const h = Math.max(1, Math.min(r.h, max, size - r.y));
  const pixels = await db.pixel.findMany({
    ...inRegion({ x: r.x, y: r.y, w, h }),
    select: { x: true, y: true, color: true },
  });
  return renderPng({ ox: r.x, oy: r.y, w, h, pixels });
}

module.exports = { inRegion, renderGrid };
