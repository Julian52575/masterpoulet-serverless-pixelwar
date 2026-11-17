const { SIZE, MAX_BRUSH, isCoordinate } = require("./grid");
const { PALETTE, normalizeColor } = require("./palette");

const INVALID_COORDINATES = `❌ x and y must be whole numbers between 0 and ${SIZE - 1}.`;
const INVALID_COLOR =
  "❌ Invalid color: use a hex code like #ff0000, " +
  `or a palette color: ${Object.keys(PALETTE).join(", ")}.`;

function validateDraw(payload) {
  const { x, y, color } = payload ?? {};
  if (!isCoordinate(x) || !isCoordinate(y)) return { ok: false, error: INVALID_COORDINATES };

  const hex = normalizeColor(color);
  if (!hex) return { ok: false, error: INVALID_COLOR };

  return { ok: true, pixel: { x, y, color: hex } };
}

const SNOWFLAKE = /^\d{1,20}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_AREA = MAX_BRUSH * MAX_BRUSH;

class InvalidCommandError extends Error {}

const isEdge = (value) => Number.isInteger(value) && value >= 0 && value <= SIZE;

function readRect(rect) {
  const { x0, y0, x1, y1 } = rect ?? {};
  if (![x0, y0, x1, y1].every(isEdge) || x0 >= x1 || y0 >= y1) {
    throw new InvalidCommandError("rect must be inside the grid with x0 < x1 and y0 < y1");
  }
  if ((x1 - x0) * (y1 - y0) > MAX_AREA) {
    throw new InvalidCommandError(`rect covers more than ${MAX_AREA} pixels`);
  }
  return { x0, y0, x1, y1 };
}

function cellsOf({ x0, y0, x1, y1 }) {
  const cells = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) cells.push({ x, y });
  }
  return cells;
}

function readWebDraw(event) {
  if (event.source !== "web") throw new InvalidCommandError("source must be web");
  if (typeof event.user_id !== "string" || !SNOWFLAKE.test(event.user_id)) {
    throw new InvalidCommandError("invalid user_id");
  }
  if (typeof event.request_id !== "string" || !REQUEST_ID.test(event.request_id)) {
    throw new InvalidCommandError("invalid request_id");
  }

  const color = normalizeColor(event.color);
  if (!color) throw new InvalidCommandError("invalid color");

  const drawnAt = new Date(typeof event.requested_at === "string" ? event.requested_at : NaN);
  if (Number.isNaN(drawnAt.getTime())) throw new InvalidCommandError("invalid requested_at");

  return {
    requestId: event.request_id,
    author: event.user_id,
    authorName: typeof event.username === "string" ? event.username : null,
    color,
    drawnAt,
    cells: cellsOf(readRect(event.rect))
  };
}

module.exports = {
  validateDraw,
  readWebDraw,
  cellsOf,
  InvalidCommandError,
  INVALID_COORDINATES,
  INVALID_COLOR,
  MAX_AREA
};
