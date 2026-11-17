const PALETTE = {
  black: "#000000",
  white: "#ffffff",
  red: "#e50000",
  orange: "#ff9900",
  yellow: "#ffe600",
  green: "#02be01",
  blue: "#0083c7",
  purple: "#820080"
};

const HEX = /^#?([0-9a-f]{6})$/;

function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (Object.hasOwn(PALETTE, color)) return PALETTE[color];
  const match = HEX.exec(color);
  return match ? `#${match[1]}` : null;
}

module.exports = { PALETTE, normalizeColor };
