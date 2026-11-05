const { SIZE, isCoordinate } = require("./grid");
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

module.exports = { validateDraw, INVALID_COORDINATES, INVALID_COLOR };
