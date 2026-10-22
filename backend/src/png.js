const zlib = require("zlib");

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), body.length + 4);
  return out;
}

// pixels: [{x, y, color}] already inside the w*h window starting at (ox, oy).
function renderPng({ ox, oy, w, h, pixels }) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h, 0xff);
  for (let row = 0; row < h; row++) raw[row * stride] = 0;
  for (const p of pixels) {
    const i = (p.y - oy) * stride + 1 + (p.x - ox) * 3;
    const n = parseInt(p.color.slice(1), 16);
    raw[i] = n >> 16;
    raw[i + 1] = (n >> 8) & 255;
    raw[i + 2] = n & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { renderPng };
