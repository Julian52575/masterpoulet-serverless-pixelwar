const { createReplier } = require("./reply");
const { renderCanvas } = require("./render");

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const EMPTY_CANVAS = "🖼️ The canvas is empty for now.";
const canvasImage = ({ count, region, scale }) =>
  `🖼️ Current canvas: ${plural(count, "pixel")}, from (${region.x0}, ${region.y0}) to (${region.x1}, ${region.y1})` +
  (scale > 1 ? `, image scaled down ${scale} times to fit in Discord.` : ".");
const imageName = (at) => `pixelwar-${at.toISOString().replace(/[:.]/g, "-")}.png`;

function createHandlers({ canvas, discord, now = () => Date.now() }) {
  const reply = createReplier({ discord });

  return {
    get: async (event) => {
      const image = renderCanvas(await canvas.visiblePixels());
      const content = image.count === 0 ? EMPTY_CANVAS : canvasImage(image);
      await reply(event, content, [{ name: imageName(new Date(now())), data: image.png, contentType: "image/png" }]);
    }
  };
}

module.exports = { createHandlers, EMPTY_CANVAS, canvasImage, imageName };
