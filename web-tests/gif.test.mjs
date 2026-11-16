// GIF export: the encoder (round-tripped through a small decoder here) and the
// frame plan. tests/test_export.py checks real GIFs from the viewer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GifWriter, TRANSPARENT, changedRect, encodeGif, gifDelays, histogram, lzw, makeMapper, medianCut } from "../web/js/gif.js";
import { GIF_VIEWS, coverageBox, fitFrame, gifFileName, gifPlan, gifSize } from "../web/js/gifplan.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sky = load("../templates/lightning/sky-strike.json");
const index = load("../templates/index.json").templates.map((p) => load(`../templates/${p}`));
const aura = index.find((t) => t.timing?.loop_range);

// A minimal GIF decoder: global palette, LZW, transparency and "do not dispose".
function decodeLzw(bytes, minCode, pixels) {
  const out = [];
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict = [];
  const reset = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push(null, null);
    size = minCode + 1;
  };
  reset();
  let prev = null;
  let bit = 0;
  while (out.length < pixels) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat(prev[0]);
    else throw new Error(`bad code ${code}`);
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push(prev.concat(entry[0]));
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

function decodeGif(buf) {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => buf[p++] | (buf[p++] << 8);
  assert.equal(String.fromCharCode(...buf.subarray(0, 6)), "GIF89a");
  p = 6;
  const W = u16();
  const H = u16();
  const flags = u8();
  p += 2;
  const palette = [];
  for (let i = 0; i < 2 << (flags & 7); i++) palette.push([u8(), u8(), u8()]);
  const canvas = new Array(W * H).fill(null);
  const frames = [];
  let gce = { delay: 0, transparent: null };
  let loop = null;
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const packed = u8();
        const delay = u16();
        const ti = u8();
        u8();
        gce = { delay, transparent: packed & 1 ? ti : null };
      } else {
        const blocks = [];
        for (let n = u8(); n; n = u8()) {
          blocks.push(buf.subarray(p, p + n));
          p += n;
        }
        if (label === 0xff && String.fromCharCode(...blocks[0]) === "NETSCAPE2.0") loop = blocks[1][1] | (blocks[1][2] << 8);
      }
      continue;
    }
    assert.equal(b, 0x2c);
    const x = u16(), y = u16(), w = u16(), h = u16();
    assert.equal(u8() & 0x80, 0, "no local palettes");
    const min = u8();
    const data = [];
    for (let n = u8(); n; n = u8()) {
      data.push(...buf.subarray(p, p + n));
      p += n;
    }
    const idx = decodeLzw(data, min, w * h);
    assert.equal(idx.length, w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = idx[j * w + i];
        if (v !== gce.transparent) canvas[(y + j) * W + x + i] = palette[v];
      }
    }
    frames.push({ delay: gce.delay, rect: { x, y, w, h }, pixels: canvas.slice() });
  }
  return { W, H, loop, palette, frames };
}

function frame(W, H, fn) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set([...fn(x, y), 255], (y * W + x) * 4);
  return px;
}

test("encodeGif round-trips: size, loop, delays and colors", () => {
  const W = 37, H = 23;
  const frames = [0, 1, 2].map((f) => frame(W, H, (x, y) => (Math.abs(x - 10 * f - 5) < 3 ? [250, 240, 40] : [10, 12, 20 + y])));
  const gif = decodeGif(encodeGif(frames, { width: W, height: H, delays: [5, 5, 7] }));
  assert.equal(gif.W, W);
  assert.equal(gif.H, H);
  assert.equal(gif.loop, 0, "loops forever");
  assert.deepEqual(gif.frames.map((f) => f.delay), [5, 5, 7]);
  gif.frames.forEach((fr, f) => {
    for (let i = 0; i < W * H; i++) {
      const src = frames[f].subarray(i * 4, i * 4 + 3);
      const got = fr.pixels[i];
      assert.ok(got, "every pixel is drawn");
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - src[c]) <= 6, `frame ${f} pixel ${i}: ${got} vs ${[...src]}`);
    }
  });
  // Later frames only store the changed rectangle.
  assert.deepEqual(gif.frames[0].rect, { x: 0, y: 0, w: W, h: H });
  assert.ok(gif.frames[1].rect.w < W);
});

test("a frame identical to the last one extends its delay instead", () => {
  const a = frame(8, 8, () => [200, 0, 0]);
  const b = frame(8, 8, (x) => (x < 4 ? [0, 200, 0] : [200, 0, 0]));
  const gif = decodeGif(encodeGif([a, b, b, b], { width: 8, height: 8, delays: [4, 4, 4, 4] }));
  assert.deepEqual(gif.frames.map((f) => f.delay), [4, 12]);
});

test("LZW handles a full code table (noise) and resets", () => {
  let s = 7;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  const idx = Uint8Array.from({ length: 20000 }, rand);
  assert.deepEqual(decodeLzw(lzw(idx), 8, idx.length), [...idx]);
  assert.deepEqual(decodeLzw(lzw(new Uint8Array(5000)), 8, 5000), new Array(5000).fill(0));
});

test("the palette keeps small bright details next to a big background", () => {
  const px = frame(200, 200, (x, y) => (x < 3 && y < 3 ? [255, 255, 255] : [12 + (x % 40), 14, 20 + (y % 50)]));
  const pal = medianCut(histogram([px]));
  assert.ok(pal.length <= 255);
  const map = makeMapper(pal);
  const white = pal[map(255, 255, 255)];
  assert.ok(white.every((c) => c > 240), `white maps to ${white}`);
});

test("the transparent index is never a palette color", () => {
  const px = frame(64, 64, (x, y) => [x * 4, y * 4, (x * y) % 256]);
  const w = new GifWriter({ width: 64, height: 64, palette: medianCut(histogram([px])) });
  w.addFrame(px, 5);
  const gif = decodeGif(w.finish());
  assert.ok(gif.frames[0].pixels.every(Boolean));
  assert.ok(medianCut(histogram([px])).length <= TRANSPARENT);
});

test("changedRect finds the box that differs", () => {
  const a = new Uint8Array(20);
  const b = a.slice();
  b[7] = 1;
  b[13] = 2;
  assert.deepEqual(changedRect(a, b, 5, 4), { x: 2, y: 1, w: 2, h: 2 });
  assert.equal(changedRect(a, a, 5, 4), null);
});

test("gifDelays keep the running total exact", () => {
  const d = gifDelays(30, 1000 / 30);
  assert.equal(d.reduce((a, b) => a + b, 0), 100);
  assert.ok(d.every((x) => x === 3 || x === 4));
  assert.deepEqual(gifDelays(3, 50), [5, 5, 5]);
});

test("gifPlan records the whole spell at the GIF's frame rate", () => {
  const p = gifPlan(sky, { fps: 20 });
  assert.equal(p.length, "spell");
  assert.equal(p.times.length, Math.ceil(sky.timing.duration_ms / 50));
  assert.equal(p.times[1], 50);
  assert.equal(p.delays.reduce((a, b) => a + b, 0), p.times.length * 5);
  // Slow motion: more frames, same delay each.
  const slow = gifPlan(sky, { fps: 20, speed: 0.5 });
  assert.equal(slow.times[1], 25);
  assert.equal(slow.delays[0], 5);
});

test("gifPlan records an aura's seamless loop by default, the whole spell on request", () => {
  assert.ok(aura, "there is an aura template");
  const lr = aura.timing.loop_range;
  const p = gifPlan(aura, { fps: 15 });
  assert.equal(p.length, "loop");
  assert.equal(p.times[0], lr.start_ms);
  const step = p.times[1] - p.times[0];
  assert.ok(Math.abs(p.times.at(-1) + step - lr.end_ms) < 1e-6, "the next frame would be the loop's end, which is its start");
  const whole = gifPlan(aura, { fps: 15, length: "spell" });
  assert.equal(whole.length, "spell");
  assert.equal(whole.times[0], 0);
  // Not an aura: "loop" falls back to the whole spell.
  assert.equal(gifPlan(sky, { length: "loop" }).length, "spell");
});

test("GIF views, sizes and file names", () => {
  assert.deepEqual(GIF_VIEWS, ["front", "side", "top", "three_quarter", "quad"]);
  assert.deepEqual(gifSize(480), { width: 480, height: 360 });
  assert.deepEqual(gifSize(5000), { width: 1280, height: 960 });
  assert.equal(gifFileName("fire-pyre-ward", 3, "stylized", "quad"), "fire-pyre-ward-seed3-four-views.gif");
  assert.equal(gifFileName("fire-pyre-ward", 3, "toon", "three_quarter"), "fire-pyre-ward-seed3-toon-three-quarter.gif");
});

test("fitFrame keeps the usual framing when the spell fits, and only ever widens it", () => {
  assert.equal(fitFrame({ x0: 50, y0: 40, x1: 300, y1: 200 }, 480, 360), null);
  assert.equal(fitFrame(null, 480, 360), null);
  // A spell rising above the frame: widen, keep 4:3, cover the whole spell and the usual frame.
  const f = fitFrame({ x0: 100, y0: -300, x1: 380, y1: 330 }, 480, 360);
  assert.ok(Math.abs(f.w / f.h - 480 / 360) < 1e-9);
  assert.ok(f.y < -300 && f.y + f.h > 360 && f.x <= 0 && f.x + f.w >= 480);
});

test("coverageBox drops a stray wisp but keeps the spell", () => {
  const cols = new Float64Array(100);
  const rows = new Float64Array(100);
  for (let i = 40; i <= 60; i++) {
    cols[i] = 1000;
    rows[i] = 1000;
  }
  cols[2] = 1; // one stray pixel far away
  rows[97] = 1;
  assert.deepEqual(coverageBox(cols, rows), { x0: 40, y0: 40, x1: 60, y1: 60 });
  assert.equal(coverageBox(new Float64Array(5), new Float64Array(5)), null);
});
