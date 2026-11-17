const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { TILE, TILES_PER_SIDE, tileId, parseTileId, emptyTile, encodeTile, decodeTile, paint, countPainted, InvalidTileError } = require("./tiles");
const { encodePng, SIGNATURE } = require("./png");

describe("tile ids", () => {
  test("cuts the 10000x10000 grid into 40x40 tiles of 256", () => {
    assert.equal(TILE, 256);
    assert.equal(TILES_PER_SIDE, 40);
    assert.equal(tileId(255, 256), "0_1");
    assert.deepEqual(parseTileId("39_7"), [39, 7]);
  });
});

describe("encodeTile / decodeTile", () => {
  test("round-trips the pixels, including transparency", () => {
    const rgba = emptyTile();
    paint(rgba, 1, 2, { x: 256, y: 512, color: "#ff8000" });
    paint(rgba, 1, 2, { x: 511, y: 767, color: "#000001" });

    const png = encodeTile(rgba);
    assert.deepEqual(png.subarray(0, 8), SIGNATURE);
    assert.deepEqual(decodeTile(png), rgba);
  });

  test("an empty tile is fully transparent and compresses to almost nothing", () => {
    const png = encodeTile(emptyTile());
    assert.equal(countPainted(decodeTile(png)), 0);
    assert.ok(png.length < 1024);
  });

  test("paint writes the color at the right place, opaque", () => {
    const rgba = emptyTile();
    paint(rgba, 0, 0, { x: 3, y: 1, color: "#102030" });
    const at = (1 * TILE + 3) * 4;
    assert.deepEqual([...rgba.subarray(at, at + 4)], [0x10, 0x20, 0x30, 255]);
    assert.equal(countPainted(rgba), 1);
  });

  test("refuses something that is not a PNG", () => {
    assert.throws(() => decodeTile(Buffer.from("hello")), InvalidTileError);
    assert.throws(() => decodeTile(null), InvalidTileError);
  });

  test("refuses a PNG with the wrong size or color type", () => {
    const rgb = encodePng({ width: TILE, height: TILE, rgb: Buffer.alloc(TILE * TILE * 3) });
    assert.throws(() => decodeTile(rgb), /RGBA/);
  });

  test("refuses a truncated tile", () => {
    const png = encodeTile(emptyTile());
    const idatStart = png.indexOf("IDAT") - 4;
    const tiny = zlib.deflateSync(Buffer.alloc(10));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(tiny.length);
    const broken = Buffer.concat([png.subarray(0, idatStart), length, Buffer.from("IDAT"), tiny, Buffer.alloc(4), Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.alloc(4)]);
    assert.throws(() => decodeTile(broken), InvalidTileError);
  });
});
