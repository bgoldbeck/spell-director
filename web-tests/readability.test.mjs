import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  band, boxIn, columnExtent, coreMask, defaultTracking, keyFrames, readsUntil, resolveReadability, screenPx, trackingFor,
} from "../web/js/engine/readability.js";
import { buildManifest, buildTracks, framePlan, guideMarkdown } from "../web/js/engine/spritesheet.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const jet = load("../templates/fire/flame-jet.json");
const sky = load("../templates/lightning/sky-strike.json");

test("tracking defaults: decals stay, free particles trail, the rest follows", () => {
  assert.equal(defaultTracking({ type: "decal" }), "stay");
  assert.equal(defaultTracking({ type: "smoke" }), "trail");
  assert.equal(defaultTracking({ type: "sparks", params: {} }), "trail");
  assert.equal(defaultTracking({ type: "sparks", params: { steady: true } }), "follow");
  assert.equal(defaultTracking({ type: "sparks", attach_to: "orb" }), "follow");
  assert.equal(defaultTracking({ type: "beam" }), "follow");
  assert.equal(defaultTracking({ type: "sound_cue" }), null);
  assert.equal(trackingFor({ type: "smoke", tracking: "follow" }), "follow");
  assert.equal(trackingFor({ type: "camera_shake", tracking: "follow" }), null);
});

test("the flame jet's readability: authored reference, cues and key frames", () => {
  const r = resolveReadability(jet);
  assert.equal(r.reference_distance, 3.4);
  assert.equal(r.reference_source, "readability.reference_distance");
  assert.deepEqual(r.must_read.map((c) => c.cue), ["hand-to-jet connection", "thin hot core", "clear first hit"]);
  assert.deepEqual(r.key_frames.map((k) => k.label), ["ignition", "first contact", "shutdown"]);
  for (const l of jet.layers) if (!["sound_cue", "camera_shake"].includes(l.type)) assert.ok(l.tracking, `${l.id} says how it tracks`);
});

test("without a readability block, the reference comes from the footprint and key frames from the beats", () => {
  const r = resolveReadability(sky);
  assert.equal(r.authored, false);
  assert.ok(r.reference_source.startsWith("space.footprint") || r.reference_source === "default");
  const k = keyFrames(sky);
  assert.ok(k.length >= 1 && k.every((x) => x.source === "derived"));
  assert.deepEqual(k.map((x) => x.t_ms), k.map((x) => x.t_ms).slice().sort((a, b) => a - b));
});

test("screen size: 1 unit at 1 unit away fills most of a 1080p, 60 degree screen", () => {
  assert.ok(Math.abs(screenPx(1, 1) - 935.3) < 0.5);
  assert.ok(Math.abs(screenPx(0.1, 10) - 9.35) < 0.05);
  assert.equal(band(0.5).id, "lost");
  assert.equal(band(2).id, "flicker");
  assert.equal(band(5).id, "line");
  assert.equal(band(20).id, "shape");
  assert.ok(Math.abs(screenPx(0.03, readsUntil(0.03, 3)) - 3) < 1e-9);
});

test("pixel measures: column extent, core mask and boxes", () => {
  const w = 6, h = 5;
  const px = new Uint8Array(w * h * 4);
  const set = (x, y, v) => px.set([v, v, v, 255], (y * w + x) * 4);
  set(2, 1, 255); set(2, 2, 100); set(2, 3, 255); set(4, 2, 255);
  const core = coreMask(px, w, h);
  assert.deepEqual(columnExtent(core, w, h, 2, 0), { y0: 1, y1: 3, px: 3 });
  assert.equal(columnExtent(core, w, h, 0, 0), null);
  assert.deepEqual(boxIn(core, w, h, 3, 5), { x0: 4, y0: 2, x1: 4, y1: 2, w: 1, h: 1 });
  // A stray spark well above the beam is not part of its thickness.
  const tall = new Uint8Array(1 * 30);
  tall[2] = 1;
  for (let y = 10; y <= 20; y++) tall[y] = 1;
  assert.deepEqual(columnExtent(tall, 1, 30, 0, 0), { y0: 10, y1: 20, px: 11 });
});

test("the export carries tracking and the quality target into its JSON and guide", () => {
  const plan = framePlan(jet);
  const sheets = [{ id: "all", first: 0, count: plan.count, layout: { width: 1, height: 1, columns: 1, rows: 1, blocks: 1 } }];
  const m = buildManifest({ template: jet, seed: 1, plan, sheets, visible: {}, views: { side: {} }, tracks: buildTracks(jet, 1, plan), frame: 64 });
  const scorch = m.layers.find((l) => l.id === "scorch");
  assert.equal(scorch.tracking, "stay");
  assert.equal(m.layers.find((l) => l.id === "smoke").tracking, "trail");
  assert.equal(m.readability.reference_distance, 3.4);
  const md = guideMarkdown(m, { files: [] });
  assert.match(md, /## Quality target/);
  assert.match(md, /3D rebuild bar/);
  assert.match(md, /front, side, top and behind the caster/);
  assert.match(md, /thin hot core/);
  assert.match(md, /stays where it landed: `scorch`, `burn-patch`/);
  assert.match(md, /Simulation Space to World/);
});
