const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createHandlers, EMPTY_CANVAS, canvasImage, imageName } = require("./handlers");
const { SIGNATURE } = require("./png");

function make(pixels) {
  const replies = [];
  const canvas = { visiblePixels: async () => pixels };
  const discord = { editOriginal: async (event, message, files) => replies.push({ message, files }) };
  const handlers = createHandlers({ canvas, discord, now: () => Date.UTC(2026, 9, 29, 12, 30, 5, 123) });
  return { get: handlers.get, replies };
}

const event = { type: "get", user_id: "111", application_id: "123456789012345678", interaction_token: "tok" };
const px = (x, y, color) => ({ x, y, color, updated_at: new Date(Date.UTC(2026, 9, 29)) });

describe("get handler", () => {
  test("replies with the rendered canvas as a PNG attachment", async () => {
    const { get, replies } = make([px(10, 20, "#ff0000"), px(12, 25, "#0000ff")]);
    await get(event);

    const [{ message, files }] = replies;
    assert.equal(message.content, "🖼️ La grille actuelle : 2 pixels, de (10, 20) à (12, 25).");
    assert.equal(files.length, 1);
    assert.equal(files[0].contentType, "image/png");
    assert.equal(files[0].name, "pixelwar-2026-10-29T12-30-05-123Z.png");
    assert.deepEqual(files[0].data.subarray(0, 8), SIGNATURE);
  });

  test("says when the canvas is empty, and still sends an image", async () => {
    const { get, replies } = make([]);
    await get(event);
    assert.equal(replies[0].message.content, EMPTY_CANVAS);
    assert.equal(replies[0].files.length, 1);
  });

  test("tells when the image had to be shrunk", () => {
    const text = canvasImage({ count: 3, region: { x0: 0, y0: 0, x1: 9999, y1: 9999 }, scale: 5 });
    assert.match(text, /réduite 5 fois/);
  });

  test("names the image after the time it was taken, with no character Discord would refuse", () => {
    assert.match(imageName(new Date(Date.UTC(2026, 0, 1))), /^[A-Za-z0-9_.-]+$/);
  });
});
