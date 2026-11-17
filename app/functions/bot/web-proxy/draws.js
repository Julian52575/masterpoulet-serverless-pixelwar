const { SIZE, MAX_BRUSH, isCoordinate } = require("./grid");
const { normalizeColor } = require("./palette");

const ROUTES = { "/pixels": "pixel", "/brush": "brush" };

class InvalidDrawError extends Error {}

function routeOf(path) {
  const clean = String(path ?? "").replace(/\/+$/, "").replace(/^\/api(?=\/)/, "");
  return ROUTES[clean] ?? null;
}

function brushRect(x, y, size) {
  const start = x - Math.floor((size - 1) / 2);
  const top = y - Math.floor((size - 1) / 2);
  return {
    x0: Math.max(0, start),
    y0: Math.max(0, top),
    x1: Math.min(SIZE, start + size),
    y1: Math.min(SIZE, top + size)
  };
}

function readDraw(route, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidDrawError("the body must be a JSON object");
  }

  const { x, y, color, size } = body;
  if (!isCoordinate(x) || !isCoordinate(y)) {
    throw new InvalidDrawError(`x and y must be whole numbers between 0 and ${SIZE - 1}`);
  }

  const hex = normalizeColor(color);
  if (!hex) throw new InvalidDrawError("invalid color: use a hex code like #ff0000 or a palette name");

  if (route === "pixel") return { rect: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, color: hex };

  if (!Number.isInteger(size) || size < 1 || size > MAX_BRUSH) {
    throw new InvalidDrawError(`size must be a whole number between 1 and ${MAX_BRUSH}`);
  }
  return { rect: brushRect(x, y, size), color: hex };
}

const areaOf = ({ x0, y0, x1, y1 }) => (x1 - x0) * (y1 - y0);

module.exports = { routeOf, readDraw, brushRect, areaOf, InvalidDrawError };
