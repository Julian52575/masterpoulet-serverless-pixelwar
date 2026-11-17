const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { routeOf, readDraw, brushRect, areaOf, InvalidDrawError } = require("./draws");

describe("routeOf", () => {
  for (const [path, route] of [
    ["/pixels", "pixel"],
    ["/pixels/", "pixel"],
    ["/api/pixels", "pixel"],
    ["/brush", "brush"],
    ["/api/brush", "brush"],
    ["/", null],
    ["/pixels/1/2", null],
    ["/api/tiles/0/0", null],
    [undefined, null]
  ]) {
    test(`${path} → ${route}`, () => assert.equal(routeOf(path), route));
  }
});

describe("readDraw", () => {
  test("turns a pixel into a 1×1 rectangle and normalizes the color", () => {
    assert.deepEqual(readDraw("pixel", { x: 10, y: 20, color: "RED" }), {
      rect: { x0: 10, y0: 20, x1: 11, y1: 21 },
      color: "#e50000"
    });
  });

  test("ignores an author sent in the body", () => {
    assert.deepEqual(readDraw("pixel", { x: 0, y: 0, color: "#00ff00", author: "mallory" }), {
      rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
      color: "#00ff00"
    });
  });

  test("turns a brush into a square around the point", () => {
    assert.deepEqual(readDraw("brush", { x: 10, y: 20, color: "blue", size: 5 }).rect, { x0: 8, y0: 18, x1: 13, y1: 23 });
  });

  for (const body of [
    null,
    [],
    "x",
    { x: -1, y: 0, color: "red" },
    { x: 10000, y: 0, color: "red" },
    { x: 1.5, y: 0, color: "red" },
    { x: "1", y: 0, color: "red" },
    { x: 1, y: 1, color: "not-a-color" },
    { x: 1, y: 1 }
  ]) {
    test(`rejects the pixel ${JSON.stringify(body)}`, () => {
      assert.throws(() => readDraw("pixel", body), InvalidDrawError);
    });
  }

  for (const size of [undefined, 0, 17, 2.5, "4"]) {
    test(`rejects a brush of size ${JSON.stringify(size)}`, () => {
      assert.throws(() => readDraw("brush", { x: 1, y: 1, color: "red", size }), InvalidDrawError);
    });
  }
});

describe("brushRect", () => {
  test("a size of 1 is the pixel itself", () => {
    assert.deepEqual(brushRect(5, 5, 1), { x0: 5, y0: 5, x1: 6, y1: 6 });
  });

  test("an even size leans towards the bottom right", () => {
    assert.deepEqual(brushRect(5, 5, 4), { x0: 4, y0: 4, x1: 8, y1: 8 });
  });

  test("is clipped to the grid", () => {
    assert.deepEqual(brushRect(0, 9999, 16), { x0: 0, y0: 9992, x1: 9, y1: 10000 });
  });
});

describe("areaOf", () => {
  test("counts the pixels of a rectangle", () => {
    assert.equal(areaOf({ x0: 0, y0: 0, x1: 4, y1: 3 }), 12);
  });
});
