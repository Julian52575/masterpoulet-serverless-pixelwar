const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validateDraw, INVALID_COORDINATES, INVALID_COLOR } = require("./draw");
const { normalizeColor, PALETTE } = require("./palette");
const { isCoordinate, SIZE, TILE } = require("./grid");

describe("grid", () => {
  test("matches the team backend: 10000x10000 split in 256x256 tiles", () => {
    assert.equal(SIZE, 10000);
    assert.equal(TILE, 256);
  });

  for (const value of [0, 1, 5000, 9999]) {
    test(`accepts the coordinate ${value}`, () => assert.equal(isCoordinate(value), true));
  }

  for (const value of [-1, 10000, 1.5, "10", null, undefined, Number.NaN, Infinity]) {
    test(`refuses the coordinate ${String(value)}`, () => assert.equal(isCoordinate(value), false));
  }
});

describe("normalizeColor", () => {
  test("keeps a lowercase #rrggbb color", () => {
    assert.equal(normalizeColor("#ff0000"), "#ff0000");
  });

  test("lowercases an uppercase hex color", () => {
    assert.equal(normalizeColor("#FF00AA"), "#ff00aa");
  });

  test("accepts a hex color typed without #", () => {
    assert.equal(normalizeColor("00ff00"), "#00ff00");
  });

  test("ignores the spaces around the color", () => {
    assert.equal(normalizeColor("  #0000ff  "), "#0000ff");
  });

  test("translates every palette name, whatever the case", () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      assert.equal(normalizeColor(name), hex);
      assert.equal(normalizeColor(name.toUpperCase()), hex);
    }
  });

  test("uses exactly the palette of the team backend", () => {
    assert.deepEqual(PALETTE, {
      black: "#000000",
      white: "#ffffff",
      red: "#e50000",
      orange: "#ff9900",
      yellow: "#ffe600",
      green: "#02be01",
      blue: "#0083c7",
      purple: "#820080"
    });
  });

  for (const value of ["#fff", "#ff00000", "#gg0000", "rouge", "##ff0000", "toString", "constructor", "", 16711680, null]) {
    test(`refuses ${JSON.stringify(value)}`, () => assert.equal(normalizeColor(value), null));
  }
});

describe("validateDraw", () => {
  test("returns the pixel with a normalized color", () => {
    assert.deepEqual(validateDraw({ x: 10, y: 20, color: "RED" }), {
      ok: true,
      pixel: { x: 10, y: 20, color: "#e50000" }
    });
  });

  test("accepts the four corners of the grid", () => {
    for (const [x, y] of [[0, 0], [9999, 0], [0, 9999], [9999, 9999]]) {
      assert.equal(validateDraw({ x, y, color: "#000000" }).ok, true);
    }
  });

  test("refuses coordinates outside the grid", () => {
    assert.deepEqual(validateDraw({ x: 10000, y: 0, color: "red" }), { ok: false, error: INVALID_COORDINATES });
    assert.deepEqual(validateDraw({ x: 0, y: -1, color: "red" }), { ok: false, error: INVALID_COORDINATES });
  });

  test("refuses a missing coordinate", () => {
    assert.deepEqual(validateDraw({ x: 5, color: "red" }), { ok: false, error: INVALID_COORDINATES });
  });

  test("refuses an invalid color", () => {
    assert.deepEqual(validateDraw({ x: 5, y: 5, color: "@everyone" }), { ok: false, error: INVALID_COLOR });
  });

  test("checks the coordinates before the color", () => {
    assert.equal(validateDraw({ x: -1, y: 5, color: "nope" }).error, INVALID_COORDINATES);
  });

  test("survives a missing payload", () => {
    assert.equal(validateDraw(undefined).error, INVALID_COORDINATES);
  });

  test("explains the expected range and lists the palette in the error messages", () => {
    assert.match(INVALID_COORDINATES, /entre 0 et 9999/);
    for (const name of Object.keys(PALETTE)) assert.match(INVALID_COLOR, new RegExp(name));
  });

  test("never copies what the user typed into the error message", () => {
    const result = validateDraw({ x: 1, y: 1, color: "<@&123> @everyone" });
    assert.ok(!result.error.includes("@everyone"));
  });
});
