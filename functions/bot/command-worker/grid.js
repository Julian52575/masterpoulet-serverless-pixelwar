const SIZE = 10000;
const TILE = 256;
const MAX_BRUSH = 16;

function isCoordinate(value) {
  return Number.isInteger(value) && value >= 0 && value < SIZE;
}

module.exports = { SIZE, TILE, MAX_BRUSH, isCoordinate };
