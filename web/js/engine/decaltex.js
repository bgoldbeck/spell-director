// Draws decal textures on a 2D canvas, seen from straight above: white (and
// greys) with alpha, tinted by the layer's palette color when rendered or
// exported. Browser only (canvas). Every texture is a pure function of
// (shape, seed, detail), so a cast always gets the same mark.

import { rng } from "./timeline.js";

const TAU = Math.PI * 2;

function radial(g, x, y, r, stops) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, c] of stops) grad.addColorStop(at, c);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

// A wobbly closed outline around the centre (radius varies with angle).
function blobPath(g, c, r, R, wobble, lobes = 7) {
  const phases = Array.from({ length: 3 }, () => R.range(0, TAU));
  g.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * TAU;
    const k = 1 + wobble * (0.5 * Math.sin(a * lobes + phases[0]) + 0.3 * Math.sin(a * (lobes + 4) + phases[1]) + 0.2 * Math.sin(a * 3 + phases[2]));
    const x = c + Math.cos(a) * r * k;
    const y = c + Math.sin(a) * r * k;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function crackLines(g, c, size, R, count, reach, width, color) {
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  const grow = (x, y, a, len, w, depth) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      a += R.range(-0.55, 0.55);
      const l = (len / steps) * R.range(0.7, 1.3);
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      g.lineTo(x, y);
      if (depth > 0 && R() < 0.35) {
        g.stroke();
        grow(x, y, a + R.sign() * R.range(0.4, 1.0), len * 0.45, w * 0.6, depth - 1);
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
      }
    }
    g.stroke();
  };
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + R.range(-0.3, 0.3);
    const start = R.range(0, size * 0.06);
    grow(c + Math.cos(a) * start, c + Math.sin(a) * start, a, reach * R.range(0.65, 1), width, 2);
  }
}

const SHAPES = {
  // Soot is nearly black whatever the palette color: drawn in dark grey, so
  // the tint only shifts its hue.
  scorch(g, s, R, detail) {
    const c = s / 2;
    g.save();
    blobPath(g, c, s * 0.36, R, 0.18 + detail * 0.12);
    g.clip();
    radial(g, c, c, s * 0.5, [[0, "rgba(30,30,30,0.95)"], [0.45, "rgba(30,30,30,0.85)"], [0.8, "rgba(30,30,30,0.35)"], [1, "rgba(30,30,30,0)"]]);
    g.restore();
    // Soot rays blown outward from the blast.
    const rays = 10 + Math.round(detail * 14);
    for (let i = 0; i < rays; i++) {
      const a = R.range(0, TAU);
      const len = s * R.range(0.28, 0.48);
      const w = s * R.range(0.015, 0.04);
      g.save();
      g.translate(c, c);
      g.rotate(a);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, "rgba(30,30,30,0.5)");
      grad.addColorStop(1, "rgba(30,30,30,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(s * 0.1, -w);
      g.lineTo(len, 0);
      g.lineTo(s * 0.1, w);
      g.fill();
      g.restore();
    }
    // Ash speckles.
    for (let i = 0; i < 30 + detail * 60; i++) {
      const a = R.range(0, TAU);
      const d = Math.sqrt(R()) * s * 0.42;
      g.fillStyle = `rgba(30,30,30,${R.range(0.2, 0.6).toFixed(2)})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, R.range(0.6, 2.2) * (s / 256), 0, TAU);
      g.fill();
    }
  },

  burn(g, s, R, detail) {
    const c = s / 2;
    g.save();
    blobPath(g, c, s * 0.3, R, 0.25);
    g.clip();
    radial(g, c, c, s * 0.42, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.7)"], [0.75, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]);
    g.restore();
    // Embers: small hot spots scattered around.
    for (let i = 0; i < 20 + detail * 40; i++) {
      const a = R.range(0, TAU);
      const d = Math.sqrt(R()) * s * 0.4;
      radial(g, c + Math.cos(a) * d, c + Math.sin(a) * d, R.range(2, 6) * (s / 256), [[0, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]);
    }
  },

  cracks(g, s, R, detail) {
    const c = s / 2;
    radial(g, c, c, s * 0.2, [[0, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]);
    crackLines(g, c, s, R, 5 + Math.round(detail * 6), s * 0.33, s * 0.014, "rgba(255,255,255,1)");
  },

  crater(g, s, R, detail) {
    const c = s / 2;
    // Rim: a lighter lumpy band (tinted, it reads as dust thrown up).
    g.save();
    blobPath(g, c, s * 0.34, R, 0.12);
    g.lineWidth = s * 0.06;
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.filter = `blur(${Math.round(s / 90)}px)`;
    g.stroke();
    g.restore();
    g.save();
    blobPath(g, c, s * 0.3, R, 0.1);
    g.clip();
    radial(g, c, c, s * 0.32, [[0, "rgba(20,20,20,1)"], [0.7, "rgba(40,40,40,0.85)"], [1, "rgba(90,90,90,0.4)"]]);
    g.restore();
    crackLines(g, c, s, R, 4 + Math.round(detail * 4), s * 0.36, s * 0.01, "rgba(15,15,15,0.85)");
    for (let i = 0; i < 12 + detail * 24; i++) {
      const a = R.range(0, TAU);
      const d = s * R.range(0.34, 0.48);
      g.fillStyle = "rgba(60,60,60,0.75)";
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, R.range(1, 3.5) * (s / 256), 0, TAU);
      g.fill();
    }
  },

  puddle(g, s, R) {
    const c = s / 2;
    for (let i = 0; i < 9; i++) {
      const a = R.range(0, TAU);
      const d = i === 0 ? 0 : R.range(0.08, 0.23) * s;
      const rad = (i === 0 ? 0.27 : R.range(0.1, 0.19)) * s;
      radial(g, c + Math.cos(a) * d, c + Math.sin(a) * d, rad, [[0, "rgba(255,255,255,0.35)"], [0.75, "rgba(255,255,255,0.3)"], [0.9, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]);
    }
  },

  splash(g, s, R, detail) {
    SHAPES.puddle(g, s, R);
    const c = s / 2;
    // Droplets thrown outward, bigger near the middle.
    for (let i = 0; i < 24 + detail * 40; i++) {
      const a = R.range(0, TAU);
      const d = s * R.range(0.22, 0.48);
      const r = (1 - d / (s * 0.5)) * R.range(3, 9) * (s / 256) + 1;
      g.save();
      g.translate(c + Math.cos(a) * d, c + Math.sin(a) * d);
      g.rotate(a);
      g.scale(R.range(1, 2.2), 1);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fill();
      g.restore();
    }
  },

  frost(g, s, R, detail) {
    const c = s / 2;
    radial(g, c, c, s * 0.3, [[0, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineCap = "round";
    const arms = 6 + Math.round(detail * 6);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + R.range(-0.15, 0.15);
      const len = s * R.range(0.3, 0.46);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      g.lineWidth = s * 0.008;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + dx * len, c + dy * len);
      g.stroke();
      // Feathered side spikes like ice crystals.
      for (let k = 1; k < 5; k++) {
        const u = k / 5;
        const bx = c + dx * len * u;
        const by = c + dy * len * u;
        const sl = len * 0.22 * (1 - u * 0.6);
        for (const side of [-1, 1]) {
          const sa = a + side * 0.7;
          g.lineWidth = s * 0.005;
          g.beginPath();
          g.moveTo(bx, by);
          g.lineTo(bx + Math.cos(sa) * sl, by + Math.sin(sa) * sl);
          g.stroke();
        }
      }
    }
  },

  // Ground scoured by a vortex: curved grooves spiralling out from a bare
  // centre, dust swept into arcs between them and grit flung outward.
  swirl(g, s, R, detail) {
    const c = s / 2;
    radial(g, c, c, s * 0.46, [[0, "rgba(255,255,255,0.12)"], [0.35, "rgba(255,255,255,0.4)"], [0.8, "rgba(255,255,255,0.22)"], [1, "rgba(255,255,255,0)"]]);
    g.lineCap = "round";
    const arms = 5 + Math.round(detail * 6);
    const turn = R.range(0.9, 1.3);
    for (let i = 0; i < arms * 3; i++) {
      const a0 = (i / (arms * 3)) * TAU + R.range(-0.2, 0.2);
      const r0 = s * R.range(0.04, 0.14);
      const r1 = s * R.range(0.3, 0.47);
      const main = i % 3 === 0;
      g.strokeStyle = `rgba(255,255,255,${main ? R.range(0.7, 0.95) : R.range(0.25, 0.5)})`;
      g.lineWidth = s * (main ? R.range(0.012, 0.02) : R.range(0.004, 0.009));
      g.beginPath();
      const steps = 40;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const rr = r0 + (r1 - r0) * u;
        const a = a0 + turn * Math.log(1 + 3 * u) + 0.04 * Math.sin(u * 17 + i);
        const x = c + Math.cos(a) * rr;
        const y = c + Math.sin(a) * rr;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Grit flung off the rim.
    g.fillStyle = "rgba(255,255,255,0.6)";
    for (let i = 0; i < 30 + detail * 60; i++) {
      const a = R.range(0, TAU);
      const d = s * R.range(0.3, 0.48);
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, R.range(1, 3.5) * (s / 512), 0, TAU);
      g.fill();
    }
  },

  rune_circle(g, s, R, detail) {
    const c = s / 2;
    g.strokeStyle = "rgba(255,255,255,1)";
    g.fillStyle = "rgba(255,255,255,1)";
    const ring = (r, w) => {
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, r, 0, TAU);
      g.stroke();
    };
    ring(s * 0.46, s * 0.012);
    ring(s * 0.4, s * 0.006);
    ring(s * 0.25, s * 0.008);
    // Glyph marks between the two outer rings.
    const glyphs = 12 + Math.round(detail * 12);
    for (let i = 0; i < glyphs; i++) {
      const a = (i / glyphs) * TAU;
      g.save();
      g.translate(c + Math.cos(a) * s * 0.43, c + Math.sin(a) * s * 0.43);
      g.rotate(a + Math.PI / 2);
      g.lineWidth = s * 0.005;
      const h = s * 0.022;
      g.beginPath();
      const strokes = R.int(2, 4);
      for (let k = 0; k < strokes; k++) {
        g.moveTo(R.range(-h, h), R.range(-h, h));
        g.lineTo(R.range(-h, h), R.range(-h, h));
      }
      g.stroke();
      g.restore();
    }
    // A star joining points on the inner ring.
    const n = [5, 6, 7, 8][R.int(0, 3)];
    const step = n === 6 ? 2 : Math.floor(n / 2);
    g.lineWidth = s * 0.006;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = ((i * step) / n) * TAU - Math.PI / 2;
      const x = c + Math.cos(a) * s * 0.4;
      const y = c + Math.sin(a) * s * 0.4;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    radial(g, c, c, s * 0.25, [[0, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]);
  },

  warning_ring(g, s, R, detail) {
    const c = s / 2;
    // Faint fill that gets stronger toward the rim, then a bright rim.
    radial(g, c, c, s * 0.47, [[0, "rgba(255,255,255,0.04)"], [0.85, "rgba(255,255,255,0.1)"], [0.97, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]]);
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = s * 0.01;
    g.beginPath();
    g.arc(c, c, s * 0.46, 0, TAU);
    g.stroke();
    const ticks = 8 + Math.round(detail * 16);
    g.lineWidth = s * 0.01;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * TAU;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4);
      g.lineTo(c + Math.cos(a) * s * 0.44, c + Math.sin(a) * s * 0.44);
      g.stroke();
    }
  },
};

export const TEXTURE_SIZE = 512;

/** Draw a decal into a new canvas of `size` px (white + alpha). */
export function drawDecal(shape, seed, { detail = 0.5, size = TEXTURE_SIZE } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  (SHAPES[shape] || SHAPES.scorch)(g, size, rng(seed), detail);
  return canvas;
}

/** A copy of a decal canvas tinted with a CSS color (for export). */
export function tintDecal(canvas, color) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext("2d");
  g.drawImage(canvas, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  g.fillRect(0, 0, out.width, out.height);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(canvas, 0, 0);
  return out;
}
