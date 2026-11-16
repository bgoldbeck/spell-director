// A small PNG encoder for data textures (RGBA, 8 bit). A canvas can't be used
// for these: it premultiplies alpha, which wipes out the color channels of a
// map whose alpha holds data (the six-way negative map's emissive channel is
// mostly 0). Uses CompressionStream("deflate") where there is one (browsers,
// Node 18+), else stores the data uncompressed. Pure: runs in Node tests too.

import { crc32 } from "../zip.js";

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// zlib stream with stored (uncompressed) deflate blocks.
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let k = 0; k < blocks; k++) {
    const part = raw.subarray(k * 65535, Math.min(raw.length, (k + 1) * 65535));
    out[o] = k === blocks - 1 ? 1 : 0;
    out[o + 1] = part.length & 0xff;
    out[o + 2] = part.length >>> 8;
    out[o + 3] = ~part.length & 0xff;
    out[o + 4] = (~part.length >>> 8) & 0xff;
    out.set(part, o + 5);
    o += 5 + part.length;
  }
  new DataView(out.buffer).setUint32(o, adler32(raw));
  return out;
}

async function zlib(raw) {
  if (typeof CompressionStream === "undefined") return zlibStored(raw);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode RGBA bytes (rows top-down) as a PNG file. Returns a Uint8Array. */
export async function encodePng(width, height, rgba) {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
