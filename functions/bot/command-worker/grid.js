const SIZE = 10000;
const TILE = 256;

function isCoordinate(value) {
  return Number.isInteger(value) && value >= 0 && value < SIZE;
}

module.exports = { SIZE, TILE, isCoordinate };
