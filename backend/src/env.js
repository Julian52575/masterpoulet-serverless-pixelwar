const SPEC_RATE_LIMIT = 20;

function parseRateLimit(raw) {
  if (raw === undefined || raw.trim() === "") return SPEC_RATE_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`RATE_LIMIT must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

module.exports = { parseRateLimit };
