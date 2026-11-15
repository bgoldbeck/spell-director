import assert from "node:assert/strict";
import test from "node:test";
import {
  beatIntensity, layerIntensity, paramAt, paramAtFrom, resolveParams, rng, seedFor,
} from "../web/js/engine/timeline.js";

test("rng is deterministic per seed", () => {
  const a = rng(42), b = rng(42), c = rng(43);
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

test("resolveParams picks ranges from the seed and keeps plain values", () => {
  const params = { width_px: { min: 6, max: 9 }, taper: 0.6, scope: "screen" };
  const p1 = resolveParams(params, 7, "bolt");
  const p2 = resolveParams(params, 7, "bolt");
  assert.deepEqual(p1, p2);
  assert.ok(p1.width_px >= 6 && p1.width_px <= 9);
  assert.equal(p1.taper, 0.6);
  assert.equal(p1.scope, "screen");
  const other = resolveParams(params, 8, "bolt");
  assert.notEqual(other.width_px, p1.width_px);
});

test("beat curves", () => {
  const b = (shape, extra = {}) => ({ id: "b", start_ms: 100, end_ms: 200, intensity: { shape, from: 0.2, to: 0.8, ...extra } });
  assert.equal(beatIntensity(b("linear"), 50), 0);
  assert.equal(beatIntensity(b("linear"), 250), 0);
  assert.ok(Math.abs(beatIntensity(b("linear"), 150) - 0.5) < 1e-9);
  assert.ok(beatIntensity(b("ease_in"), 150) < 0.5);
  assert.ok(beatIntensity(b("ease_out"), 150) > 0.5);
  assert.ok(Math.abs(beatIntensity(b("spike"), 100) - 0.2) < 1e-9);
  assert.equal(beatIntensity(b("hold"), 180), 0.2);
  const f = b("flicker", { flicker_hz: 10 });
  assert.equal(beatIntensity(f, 130, 1), beatIntensity(f, 130, 1));
});

test("layer intensity is the strongest of its beats", () => {
  const template = {
    beats: [
      { id: "a", start_ms: 0, end_ms: 100, intensity: { shape: "hold", from: 0.3 } },
      { id: "b", start_ms: 50, end_ms: 150, intensity: { shape: "hold", from: 0.9 } },
    ],
  };
  assert.equal(layerIntensity(template, { beats: ["a", "b"] }, 75), 0.9);
  assert.equal(layerIntensity(template, { beats: ["a"] }, 75), 0.3);
  assert.equal(layerIntensity(template, { beats: ["a"] }, 120), 0);
});

test("keyframes ease between values and hold at the ends", () => {
  const kfs = [
    { t_ms: 0, param: "r", value: 4 },
    { t_ms: 100, param: "r", value: 24, ease: "linear" },
  ];
  assert.equal(paramAt({ r: 8 }, kfs, "r", 0), 4);
  assert.equal(paramAt({ r: 8 }, kfs, "r", 50), 14);
  assert.equal(paramAt({ r: 8 }, kfs, "r", 500), 24);
  assert.equal(paramAt({ r: 8 }, [], "r", 50), 8);
  // A lone later keyframe is eased into from the base value.
  const one = [{ t_ms: 200, param: "w", value: 2, ease: "linear" }];
  assert.equal(paramAtFrom({ w: 10 }, one, "w", 100, 0), 6);
  assert.equal(paramAtFrom({ w: 10 }, one, "w", 300, 0), 2);
});

test("seedFor separates parts", () => {
  assert.notEqual(seedFor(1, "a", "b"), seedFor(1, "ab"));
});
