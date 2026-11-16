// Six-way lit smoke: a smoke flipbook pre-lit from six directions (right,
// left, top, bottom, back, front) and packed into two RGBA textures, so a
// shader can relight it from any light direction at runtime. This is the
// technique behind Unity VFX Graph's "Six-way Smoke Lit" output.
//
// No artist-made maps here: the puffs are baked procedurally from a seeded 3D
// density volume. For each of the six axis directions the light reaching every
// voxel is the transmittance from the face it enters through (a running sum of
// optical depth, so it's exact and cheap for axis-aligned light), then the
// camera ray through each pixel gathers the lit density front to back.
//
// Packing (Unity's): positive = (right, top, back, alpha), negative = (left,
// bottom, front, emissive). "Back" is light from behind the puff (it shines
// through the thin edges), "front" is light from the camera's side. Values
// are linear (sRGB off on import). Rows are top-down image rows.
//
// Pure (no DOM, no Three.js) so the viewer, the exporter and the Node tests
// share it.

import { rng, seedFor } from "./timeline.js";

export const SIXWAY_FRAMES = 16; // 4 x 4 flipbook: the puff over its life
export const SIXWAY_VIEW_PX = 64; // frame size in the viewer
export const SIXWAY_EXPORT_PX = 128; // frame size in exports

// Which smoke layers draw as six-way lit smoke. The layer's shader intent
// says so (`lighting: "six_way"`, also per style through `shader.styles`);
// otherwise the realistic style lights every alpha smoke layer this way.
// Glowing smoke (blend add: flame billows) and smoke marked unlit never are.
export function smokeLighting(def, style, shader) {
  if (def.type !== "smoke") return "flat";
  const lighting = shader?.lighting;
  if (lighting === "six_way") return "six_way";
  if (def.blend === "add" || def.blend === "screen") return "flat";
  if (lighting === "unlit" || lighting === "emits_light") return "flat";
  return style?.id === "realistic" ? "six_way" : "flat";
}

// Seeded value noise on a periodic 16^3 lattice.
function lattice(seed) {
  const N = 16;
  const r = rng(seedFor(seed, "sixway-lattice"));
  const v = new Float32Array(N * N * N);
  for (let i = 0; i < v.length; i++) v[i] = r();
  const at = (x, y, z) => v[((z & 15) * N + (y & 15)) * N + (x & 15)];
  const s = (t) => t * t * (3 - 2 * t);
  const noise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(at(xi, yi, zi), at(xi + 1, yi, zi), fx), l(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), fx), fy),
      l(l(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), fx), l(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), fx), fy),
      fz,
    );
  };
  // Each octave in a rotated frame, so the lattice's axes don't show.
  const oct = (x, y, z, k, o) => noise(k * (0.8 * x + 0.36 * y - 0.48 * z) + o, k * (-0.6 * x + 0.48 * y - 0.64 * z) + o, k * (0.8 * y + 0.6 * z) + o);
  return (x, y, z) => 0.5 * oct(x, y, z, 1, 0) + 0.32 * oct(z, x, y, 2.03, 5.1) + 0.18 * oct(y, z, x, 4.11, 3.7);
}

/**
 * Bake a six-way smoke flipbook. Returns {size, cols, rows, frames, width,
 * height, pos, neg} where pos/neg are RGBA bytes (width x height, rows
 * top-down) laid out as a cols x rows grid of `size` px frames, frame 0 top
 * left. Frames run over the puff's life: dense and round, billowing up and
 * out, then thinning and breaking apart.
 */
export function bakeSixWay({ size = SIXWAY_VIEW_PX, frames = SIXWAY_FRAMES, seed = 7 } = {}) {
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const width = cols * size;
  const height = rows * size;
  const pos = new Uint8ClampedArray(width * height * 4);
  const neg = new Uint8ClampedArray(width * height * 4);
  const fbm = lattice(seed);

  const S = size;
  const D = Math.max(8, size >> 1); // depth cells (the puff is as deep as it is wide)
  const step = 2 / S; // x/y cell size in puff units (-1..1)
  const stepZ = 2 / D;
  const K = 4.5; // extinction: how thick the smoke is
  const n = S * S * D;
  const sig = new Float32Array(n);
  const light = Array.from({ length: 6 }, () => new Float32Array(n)); // R L T B Back Front
  const idx = (x, y, z) => (z * S + y) * S + x;

  for (let f = 0; f < frames; f++) {
    const u = frames > 1 ? f / (frames - 1) : 0;
    const R = 0.66 + 0.24 * u; // grows over its life
    const freq = 2.4;
    const lift = u * 1.1; // noise billows upward
    const erode = 0.1 + 0.55 * u * u; // and breaks apart at the end

    // Density. Y is up (row 0 is the top of the image).
    for (let z = 0; z < D; z++) {
      const Z = ((z + 0.5) / D) * 2 - 1;
      for (let y = 0; y < S; y++) {
        const Y = 1 - ((y + 0.5) / S) * 2;
        for (let x = 0; x < S; x++) {
          const X = ((x + 0.5) / S) * 2 - 1;
          // A slightly flattened bottom: smoke puffs are rounder on top.
          const q = (X * X + (Y < 0 ? Y * Y * 1.25 : Y * Y) + Z * Z) / (R * R);
          if (q >= 1.6) {
            sig[idx(x, y, z)] = 0;
            continue;
          }
          const nz = fbm(X * freq + 8, Y * freq - lift + 8, Z * freq + 8 + u * 0.6);
          const d = (1 - q) * 1.15 + (nz - 0.5) * 1.9 - erode;
          sig[idx(x, y, z)] = d > 0 ? d * K : 0;
        }
      }
    }

    // Light transmittance from each face, as running optical depth.
    const sweep = (out, len, at, h) => {
      // at(i) -> voxel index along the light's path, i = 0 where light enters.
      let tau = 0;
      for (let i = 0; i < len; i++) {
        const v = at(i);
        const s = sig[v] * h;
        out[v] = Math.exp(-(tau + 0.5 * s));
        tau += s;
      }
    };
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < S; y++) {
        sweep(light[0], S, (i) => idx(S - 1 - i, y, z), step); // from the right (+X)
        sweep(light[1], S, (i) => idx(i, y, z), step); // from the left
      }
      for (let x = 0; x < S; x++) {
        sweep(light[2], S, (i) => idx(x, i, z), step); // from the top (row 0)
        sweep(light[3], S, (i) => idx(x, S - 1 - i, z), step); // from below
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        sweep(light[4], D, (i) => idx(x, y, i), stepZ); // from behind (z = 0 is the back)
        sweep(light[5], D, (i) => idx(x, y, D - 1 - i), stepZ); // from the camera's side
      }
    }

    // Gather along the camera ray, front (z = D-1) to back.
    const ox = (f % cols) * S;
    const oy = Math.floor(f / cols) * S;
    const c = new Float64Array(6);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        c.fill(0);
        let T = 1;
        let tau = 0;
        for (let z = D - 1; z >= 0 && T > 0.002; z--) {
          const v = idx(x, y, z);
          const s = sig[v] * stepZ;
          if (s <= 0) continue;
          const a = 1 - Math.exp(-s);
          for (let k = 0; k < 6; k++) c[k] += T * a * light[k][v];
          T *= 1 - a;
          tau += s;
        }
        const alpha = 1 - T;
        const o = ((oy + y) * width + ox + x) * 4;
        // Unpremultiply, with a little multiple scattering so the shadow side
        // isn't pitch black.
        const lit = (k) => (alpha > 1e-4 ? Math.min(1, 0.03 + 0.97 * (c[k] / alpha)) : 0) * 255;
        pos[o] = lit(0);
        pos[o + 1] = lit(2);
        pos[o + 2] = lit(4);
        pos[o + 3] = alpha * 255;
        neg[o] = lit(1);
        neg[o + 1] = lit(3);
        neg[o + 2] = lit(5);
        // Emissive: the thick core, where a fire inside the smoke glows through.
        neg[o + 3] = Math.min(1, Math.max(0, (tau - 2) / 6)) * 255;
      }
    }
  }
  return { size, cols, rows, frames, width, height, pos, neg };
}

/** Flipbook frame (fractional) for a puff at life fraction `age` (0-1). */
export function sixwayFrame(age, frames = SIXWAY_FRAMES) {
  return Math.max(0, Math.min(frames - 1, age * (frames - 1)));
}

/**
 * The light a six-way texel receives from direction `l` (unit vector in the
 * puff's frame: x right, y up, z toward the camera), given its six baked
 * values {right, left, top, bottom, back, front} (0-1). Squared components
 * weight the maps so the result is continuous and sums to one for any
 * direction. The viewer's shader does the same in GLSL.
 */
export function sixwayLight(l, m) {
  const [x, y, z] = l;
  return x * x * (x > 0 ? m.right : m.left) + y * y * (y > 0 ? m.top : m.bottom) + z * z * (z > 0 ? m.front : m.back);
}

/** The six baked values of texel (px, py) in a bake. */
export function sixwayTexel(bake, px, py) {
  const o = (py * bake.width + px) * 4;
  const p = bake.pos;
  const q = bake.neg;
  return {
    right: p[o] / 255, top: p[o + 1] / 255, back: p[o + 2] / 255, alpha: p[o + 3] / 255,
    left: q[o] / 255, bottom: q[o + 1] / 255, front: q[o + 2] / 255, emissive: q[o + 3] / 255,
  };
}
