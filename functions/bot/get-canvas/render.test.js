const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { renderCanvas } = require("./render");
const { encodePng, SIGNATURE } = require("./png");

function decodePng(png) {
  assert.deepEqual(png.subarray(0, 8), SIGNATURE);
  let offset = 8;
  let width;
  let height;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    assert.equal(crc, zlib.crc32(png.subarray(offset + 4, offset + 8 + length)), `bad CRC in ${type}`);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3 + 1;
  const at = (x, y) => {
    const i = y * stride + 1 + x * 3;
    return `#${raw.subarray(i, i + 3).toString("hex")}`;
  };
  return { width, height, at };
}

const px = (x, y, color, t = 0) => ({ x, y, color, updated_at: new Date(1_800_000_000_000 + t) });

describe("encodePng", () => {
  test("writes a valid PNG with the right size and colors", () => {
    const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const image = decodePng(encodePng({ width: 2, height: 2, rgb }));
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.equal(image.at(0, 0), "#ff0000");
    assert.equal(image.at(1, 0), "#00ff00");
    assert.equal(image.at(0, 1), "#0000ff");
    assert.equal(image.at(1, 1), "#ffffff");
  });
});

describe("renderCanvas", () => {
  test("renders an empty canvas as a small white image", () => {
    const result = renderCanvas([]);
    const image = decodePng(result.png);
    assert.equal(result.count, 0);
    assert.equal(result.region, null);
    assert.equal(image.width, 64);
    assert.equal(image.at(10, 10), "#ffffff");
  });

  test("frames the painted area, at full resolution when it fits", () => {
    const result = renderCanvas([px(100, 200, "#ff0000"), px(102, 201, "#0000ff")]);
    const image = decodePng(result.png);

    assert.deepEqual(result.region, { x0: 100, y0: 200, x1: 102, y1: 201 });
    assert.equal(result.scale, 1);
    assert.equal(image.width, 3);
    assert.equal(image.height, 2);
    assert.equal(image.at(0, 0), "#ff0000");
    assert.equal(image.at(2, 1), "#0000ff");
    assert.equal(image.at(1, 0), "#ffffff");
  });

  test("shrinks a drawing larger than the maximum so that all of it stays visible", () => {
    const result = renderCanvas([px(0, 0, "#ff0000"), px(9999, 9999, "#0000ff")], { maxSize: 1000 });
    const image = decodePng(result.png);

    assert.equal(result.scale, 10);
    assert.equal(image.width, 1000);
    assert.equal(image.height, 1000);
    assert.equal(image.at(0, 0), "#ff0000");
    assert.equal(image.at(999, 999), "#0000ff");
  });

  test("keeps a lone pixel visible after shrinking", () => {
    const result = renderCanvas([px(0, 0, "#000000"), px(9999, 9999, "#000000"), px(5003, 5007, "#ff0000")], { maxSize: 1000 });
    assert.equal(decodePng(result.png).at(500, 500), "#ff0000");
  });

  test("shows the most recent pixel when several fall in the same shrunk cell", () => {
    const pixels = [
      px(0, 0, "#000000"),
      px(9999, 9999, "#000000"),
      px(20, 20, "#00ff00", 2000),
      px(21, 21, "#ff0000", 1000)
    ];
    assert.equal(decodePng(renderCanvas(pixels, { maxSize: 1000 }).png).at(2, 2), "#00ff00");
  });

  test("never makes an image wider than the maximum", () => {
    const result = renderCanvas([px(0, 0, "#000000"), px(9999, 0, "#000000")]);
    assert.ok(result.width <= 2048);
    assert.equal(result.height, 1);
  });

  test("counts the painted pixels", () => {
    assert.equal(renderCanvas([px(1, 1, "#000000"), px(2, 2, "#000000")]).count, 2);
  });
});
