// Animated GIF encoder for the viewer's GIF export. Pure JS, no DOM, so it
// runs in the browser and in node tests.
//
// All frames share one global palette (built by median cut over every frame),
// so a still ground or background never flickers between frames. Index 255 is
// kept as the transparent color: after the first frame, each frame stores only
// the rectangle that changed, with unchanged pixels transparent, which keeps
// the files small. Optional ordered (Bayer) dithering smooths glow gradients;
// the pattern is fixed to the pixel grid, so it doesn't crawl when animated.

const BITS = 6; // bits per channel in the color histogram and lookup table
const SHIFT = 8 - BITS;
const SIDE = 1 << BITS;
const BINS = SIDE * SIDE * SIDE;
export const TRANSPARENT = 255;
const MAX_COLORS = 255; // index 255 is the transparent color

const binOf = (r, g, b) => ((r >> SHIFT) << (2 * BITS)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);

// 4x4 Bayer matrix, centred on zero (-7.5 .. 7.5)/16.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v - 7.5) / 16);

/** Count how often each (reduced) color appears, over all frames (adds to `hist` if given). */
export function histogram(frames, hist = new Uint32Array(BINS)) {
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4) hist[binOf(px[i], px[i + 1], px[i + 2])]++;
  }
  return hist;
}

/**
 * Median cut over a histogram -> palette [[r, g, b], ...] of at most maxColors.
 * Bins are weighted by the square root of their count, so small bright
 * details (a bolt core, sparks) get colors even next to a large background.
 */
export function medianCut(hist, maxColors = MAX_COLORS) {
  const bins = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) bins.push(i);
  if (!bins.length) return [[0, 0, 0]];
  const ch = (bin, c) => (bin >> ((2 - c) * BITS)) & (SIDE - 1);
  const weight = (bin) => Math.sqrt(hist[bin]);
  const boxOf = (list) => {
    const lo = [SIDE, SIDE, SIDE];
    const hi = [-1, -1, -1];
    let w = 0;
    for (const b of list) {
      for (let c = 0; c < 3; c++) {
        const v = ch(b, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
      w += weight(b);
    }
    const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = span.indexOf(Math.max(...span));
    return { list, axis, span: span[axis], w };
  };
  const boxes = [boxOf(bins)];
  while (boxes.length < maxColors) {
    // Split the box with the most (weighted) color spread.
    let best = -1;
    let score = 0;
    boxes.forEach((b, i) => {
      const s = b.span * Math.sqrt(b.w);
      if (b.list.length > 1 && b.span > 0 && s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    const a = box.axis;
    box.list.sort((p, q) => ch(p, a) - ch(q, a));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.list.length - 1; i++) {
      acc += weight(box.list[i]);
      cut = i + 1;
      if (acc >= box.w / 2) break;
    }
    // Never split between two bins with the same value on the axis.
    while (cut < box.list.length && ch(box.list[cut], a) === ch(box.list[cut - 1], a)) cut++;
    if (cut >= box.list.length) {
      cut = box.list.length - 1;
      while (cut > 0 && ch(box.list[cut], a) === ch(box.list[cut - 1], a)) cut--;
      if (cut <= 0) {
        box.span = 0; // can't split; leave it
        continue;
      }
    }
    boxes.splice(best, 1, boxOf(box.list.slice(0, cut)), boxOf(box.list.slice(cut)));
  }
  const half = 1 << (SHIFT - 1);
  return boxes.map(({ list }) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const bin of list) {
      const k = hist[bin];
      r += (ch(bin, 0) << SHIFT) * k;
      g += (ch(bin, 1) << SHIFT) * k;
      b += (ch(bin, 2) << SHIFT) * k;
      n += k;
    }
    return [Math.min(255, Math.round(r / n + half)), Math.min(255, Math.round(g / n + half)), Math.min(255, Math.round(b / n + half))];
  });
}

/** Maps an RGB color to its nearest palette index, cached per histogram bin. */
export function makeMapper(palette) {
  const cache = new Int16Array(BINS).fill(-1);
  const pr = palette.map((c) => c[0]);
  const pg = palette.map((c) => c[1]);
  const pb = palette.map((c) => c[2]);
  const half = 1 << (SHIFT - 1);
  return (r, g, b) => {
    const bin = binOf(r, g, b);
    let idx = cache[bin];
    if (idx >= 0) return idx;
    const R = ((bin >> (2 * BITS)) << SHIFT) + half;
    const G = (((bin >> BITS) & (SIDE - 1)) << SHIFT) + half;
    const B = ((bin & (SIDE - 1)) << SHIFT) + half;
    let best = Infinity;
    for (let i = 0; i < pr.length; i++) {
      const dr = pr[i] - R, dg = pg[i] - G, db = pb[i] - B;
      // Weighted distance: the eye is most sensitive to green, least to blue.
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    cache[bin] = idx;
    return idx;
  };
}

/** RGBA pixels -> palette indices (alpha is ignored: frames are opaque). */
export function indexFrame(px, width, height, map, { dither = 0 } = {}) {
  const out = new Uint8Array(width * height);
  const amp = dither * 12;
  for (let y = 0, i = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4, p++) {
      if (amp) {
        const d = BAYER[((y & 3) << 2) | (x & 3)] * amp;
        out[p] = map(clamp(px[i] + d), clamp(px[i + 1] + d), clamp(px[i + 2] + d));
      } else {
        out[p] = map(px[i], px[i + 1], px[i + 2]);
      }
    }
  }
  return out;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** GIF LZW compression of palette indices (minimum code size 8). */
export function lzw(indices, minCode = 8) {
  const out = [];
  let cur = 0;
  let nbits = 0;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  // Dictionary: (prefix code << 8 | byte) -> code.
  let dict = new Map();
  const emit = (code) => {
    cur |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  if (!indices.length) {
    emit(eoi);
    if (nbits > 0) out.push(cur & 0xff);
    return Uint8Array.from(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

class Bytes {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  push(...bytes) {
    this.add(Uint8Array.from(bytes));
  }
  word(v) {
    this.push(v & 0xff, (v >> 8) & 0xff);
  }
  text(s) {
    this.add(Uint8Array.from([...s].map((c) => c.charCodeAt(0))));
  }
  add(arr) {
    this.parts.push(arr);
    this.length += arr.length;
  }
  result() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

// The rectangle where two index frames differ, or null if they are the same.
export function changedRect(prev, cur, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      if (prev[p] !== cur[p]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Frame delays in hundredths of a second for frames `frameMs` apart, rounded
 * so the running total stays exact (e.g. 30 fps -> 3, 3, 4, 3, 3, 4, ...).
 */
export function gifDelays(count, frameMs) {
  const out = [];
  let prev = 0;
  for (let i = 1; i <= count; i++) {
    const t = Math.round((i * frameMs) / 10);
    out.push(Math.max(2, t - prev));
    prev = Math.max(t, prev + 2);
  }
  return out;
}

/**
 * Streaming GIF writer with a fixed palette: frames are indexed and
 * compressed as they arrive, so a long animation never holds every frame.
 * opts: {width, height, palette: [[r, g, b], ...] (at most 255), loop (0 = forever), dither (0..1)}
 */
export class GifWriter {
  constructor({ width, height, palette, loop = 0, dither = 0 }) {
    if (!(width > 0 && height > 0)) throw new Error("bad GIF size");
    this.width = width;
    this.height = height;
    this.dither = dither;
    this.map = makeMapper(palette.slice(0, MAX_COLORS));
    this.prev = null;
    this.last = null;
    this.frames = 0;
    const b = (this.bytes = new Bytes());
    b.text("GIF89a");
    b.word(width);
    b.word(height);
    b.push(0xf7, 0, 0); // global color table of 256 entries, 8 bits per channel
    const table = new Uint8Array(256 * 3);
    palette.slice(0, MAX_COLORS).forEach((c, i) => table.set(c, i * 3));
    b.add(table);
    // Loop (NETSCAPE2.0 application extension); 0 = forever.
    b.push(0x21, 0xff, 0x0b);
    b.text("NETSCAPE2.0");
    b.push(0x03, 0x01, loop & 0xff, (loop >> 8) & 0xff, 0x00);
  }

  /** Add an RGBA frame (width*height*4 bytes) shown for `delay` hundredths of a second. */
  addFrame(px, delay = 10) {
    const { width, height } = this;
    const idx = indexFrame(px, width, height, this.map, { dither: this.dither });
    const prev = this.prev;
    let rect = { x: 0, y: 0, w: width, h: height };
    let data = idx;
    if (prev) {
      const r = changedRect(prev, idx, width, height);
      if (!r) {
        // Nothing changed: hold the previous frame longer instead of adding one.
        this.last.setDelay(this.last.delay + delay);
        return;
      }
      rect = r;
      data = new Uint8Array(r.w * r.h);
      for (let y = 0; y < r.h; y++) {
        const row = (r.y + y) * width + r.x;
        for (let x = 0; x < r.w; x++) {
          const v = idx[row + x];
          data[y * r.w + x] = v === prev[row + x] ? TRANSPARENT : v;
        }
      }
    }
    this.last = writeFrame(this.bytes, { delay, rect, data, transparent: !!prev });
    this.prev = idx;
    this.frames++;
  }

  /** The finished file. */
  finish() {
    if (!this.frames) throw new Error("no frames to encode");
    this.bytes.push(0x3b);
    return this.bytes.result();
  }
}

/**
 * Encode RGBA frames (each width*height*4 bytes) as a looping animated GIF,
 * with one palette for all of them.
 * opts: {width, height, delays: [centiseconds per frame], loop (0 = forever), dither (0..1)}
 */
export function encodeGif(frames, { width, height, delays = [], loop = 0, dither = 0 } = {}) {
  if (!frames.length) throw new Error("no frames to encode");
  const gif = new GifWriter({ width, height, palette: medianCut(histogram(frames)), loop, dither });
  frames.forEach((px, f) => gif.addFrame(px, delays[f] ?? 10));
  return gif.finish();
}

// Writes one frame. Returns its delay and a setter that patches the delay in
// the already-written graphic control block (a repeat frame extends it).
function writeFrame(b, { delay, rect, data, transparent }) {
  const gce = Uint8Array.from([0x21, 0xf9, 0x04, (1 << 2) | (transparent ? 1 : 0), 0, 0, TRANSPARENT, 0x00]);
  const handle = {
    delay: 0,
    setDelay(v) {
      v = Math.max(0, Math.min(0xffff, Math.round(v)));
      handle.delay = v;
      gce[4] = v & 0xff;
      gce[5] = (v >> 8) & 0xff;
    },
  };
  handle.setDelay(delay);
  b.add(gce);
  b.push(0x2c);
  b.word(rect.x);
  b.word(rect.y);
  b.word(rect.w);
  b.word(rect.h);
  b.push(0x00, 8);
  const z = lzw(data, 8);
  for (let i = 0; i < z.length; i += 255) {
    const n = Math.min(255, z.length - i);
    b.push(n);
    b.add(z.subarray(i, i + n));
  }
  b.push(0x00);
  return handle;
}
