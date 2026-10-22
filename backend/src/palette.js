const { z } = require("zod");

// Named colors accepted anywhere a hex color is (the spec allows "hex or palette value").
const PALETTE = {
  black: "#000000",
  white: "#ffffff",
  red: "#e50000",
  orange: "#ff9900",
  yellow: "#ffe600",
  green: "#02be01",
  blue: "#0083c7",
  purple: "#820080",
};

const colorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((c) => PALETTE[c] ?? c)
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/));

module.exports = { PALETTE, colorSchema };
