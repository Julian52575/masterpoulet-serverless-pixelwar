const { SIZE, isCoordinate } = require("./grid");
const { PALETTE, normalizeColor } = require("./palette");

const INVALID_COORDINATES = `❌ x et y doivent être des nombres entiers entre 0 et ${SIZE - 1}.`;
const INVALID_COLOR =
  "❌ Couleur invalide : utilise un code hexadécimal comme #ff0000, " +
  `ou une couleur de la palette : ${Object.keys(PALETTE).join(", ")}.`;

function validateDraw(payload) {
  const { x, y, color } = payload ?? {};
  if (!isCoordinate(x) || !isCoordinate(y)) return { ok: false, error: INVALID_COORDINATES };

  const hex = normalizeColor(color);
  if (!hex) return { ok: false, error: INVALID_COLOR };

  return { ok: true, pixel: { x, y, color: hex } };
}

module.exports = { validateDraw, INVALID_COORDINATES, INVALID_COLOR };
