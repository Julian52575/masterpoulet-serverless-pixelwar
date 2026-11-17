const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { renderOverview } = require("./overview");
const { emptyTile, paint } = require("./tiles");

function decodeRgb(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = png.indexOf("IDAT");
  const length = png.readUInt32BE(idat - 4);
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + length));
  const pixel = (x, y) => {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    return `#${raw.subarray(at, at + 3).toString("hex")}`;
  };
  return { width, height, pixel };
}

const tileWith = (tx, ty, pixels) => {
  const rgba = emptyTile();
  for (const p of pixels) paint(rgba, tx, ty, p);
  return rgba;
};

describe("renderOverview", () => {
  test("renders an empty canvas as a small white image", async () => {
    const result = await renderOverview({ tiles: {}, loadTile: async () => assert.fail("nothing to load") });
    assert.equal(result.region, null);
    assert.equal(decodeRgb(result.png).pixel(0, 0), "#ffffff");
  });

  test("crops to the painted tiles, at full scale when it fits", async () => {
    const tile = tileWith(1, 0, [{ x: 300, y: 10, color: "#ff0000" }]);
    const result = await renderOverview({ tiles: { "1_0": {} }, loadTile: async (id) => (id === "1_0" ? tile : assert.fail()) });

    assert.deepEqual(result.region, { x0: 256, y0: 0, x1: 511, y1: 255 });
    assert.equal(result.scale, 1);
    const image = decodeRgb(result.png);
    assert.equal(image.width, 256);
    assert.equal(image.pixel(300 - 256, 10), "#ff0000");
    assert.equal(image.pixel(0, 0), "#ffffff");
  });

  test("scales down a wide area so it fits in maxSize", async () => {
    const tiles = { "0_0": {}, "3_0": {} };
    const loaded = {
      "0_0": tileWith(0, 0, [{ x: 0, y: 0, color: "#00ff00" }]),
      "3_0": tileWith(3, 0, [{ x: 1023, y: 255, color: "#0000ff" }])
    };
    const result = await renderOverview({ tiles, loadTile: async (id) => loaded[id], maxSize: 256 });

    assert.equal(result.scale, 4);
    const image = decodeRgb(result.png);
    assert.equal(image.width, 256);
    assert.equal(image.height, 64);
    assert.equal(image.pixel(0, 0), "#00ff00");
    assert.equal(image.pixel(255, 63), "#0000ff");
  });

  test("stops at the edge of the 10000x10000 grid", async () => {
    const tile = tileWith(39, 39, [{ x: 9999, y: 9999, color: "#123456" }]);
    const result = await renderOverview({ tiles: { "39_39": {} }, loadTile: async () => tile });
    assert.deepEqual(result.region, { x0: 9984, y0: 9984, x1: 9999, y1: 9999 });
    assert.equal(decodeRgb(result.png).pixel(15, 15), "#123456");
  });
});
