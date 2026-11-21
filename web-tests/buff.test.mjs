// Buffs: little story sequences on one character that resolve into a
// lingering aura, built from motifs (engine/motifplace.js) and clear bubble
// finishes. These check the motif placement math, that every buff's motifs
// loop seamlessly, and that buffs are grouped as their own kind.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GEM_CUTS, GEM_LOOKS, MOTIF_SHAPES, motifPlacement } from "../web/js/engine/motifplace.js";
import { layerLoop, layerWindow, loopHz, paramAtFrom, resolveParams } from "../web/js/engine/timeline.js";
import { groupCatalog, isBuff } from "../web/js/catalog.js";

const root = new URL("../templates/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")).templates.map((p) => JSON.parse(readFileSync(new URL(p, root), "utf8")));
const buffs = index.filter(isBuff);
// The story and gem buffs: framed close on one character.
const story = buffs.filter((t) => t.views.frame === "close");
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("an orbit spreads items evenly and turns them counter-clockwise from above", () => {
  const p = { orbit_radius_px: 50, orbit_hz: 0.25, height_px: 60 };
  const a = motifPlacement(p, 0, 4, 0);
  const b = motifPlacement(p, 1, 4, 0);
  assert.ok(near(a.x, 50) && near(a.z, 0) && near(a.y, 60));
  assert.ok(near(b.x, 0) && near(b.z, 50), "item 1 a quarter turn round, to the left");
  const later = motifPlacement(p, 0, 4, 1000); // a quarter turn later
  assert.ok(near(later.x, 0) && near(later.z, 50), "turns toward the left (counter-clockwise seen from above)");
});

test("orbit tilt lifts one side of the ring; stack and weave set heights", () => {
  const tilted = motifPlacement({ orbit_radius_px: 40, orbit_tilt_deg: 30, height_px: 50 }, 1, 4, 0);
  assert.ok(near(tilted.y, 50 + 40 * Math.sin(Math.PI / 6)));
  const stacked = motifPlacement({ stack_px: 6, height_px: 10 }, 3, 5, 0);
  assert.ok(near(stacked.y, 28));
  const up = motifPlacement({ orbit_radius_px: 40, weave_px: 8 }, 1, 6, 0);
  const down = motifPlacement({ orbit_radius_px: 40, weave_px: 8 }, 2, 6, 0);
  assert.ok(up.y > 106 && down.y < 94, "the ring waves up and down");
});

test("items pop in one after another (stagger_ms, appear_ms) with a small overshoot", () => {
  const p = { stagger_ms: 100, appear_ms: 200 };
  assert.equal(motifPlacement(p, 2, 3, 150).appear, 0, "item 2 not there yet");
  const mid = motifPlacement(p, 0, 3, 150).appear;
  assert.ok(mid > 1, "overshoots while popping in");
  assert.equal(motifPlacement(p, 2, 3, 400).appear, 1);
});

test("face out turns each item's face away from the anchor", () => {
  for (let i = 0; i < 6; i++) {
    const pl = motifPlacement({ orbit_radius_px: 30, face: "out" }, i, 6, 0);
    // A face (+z of the item) turned by yaw about the vertical: world (sin, -, cos) with left = -Z.
    const nx = Math.sin(pl.yaw);
    const nLeft = -Math.cos(pl.yaw);
    assert.ok(near(nx * pl.x + nLeft * pl.z, 30, 1e-6), `item ${i} faces outward`);
  }
});

test("there are a dozen or more close-framed buffs, each a looping aura with a story before the loop", () => {
  assert.ok(story.length >= 12, `found ${story.length}`);
  for (const t of story) {
    assert.equal(t.archetype, "aura", t.id);
    assert.ok(t.timing.loop_range?.start_ms >= 1200, `${t.id} has a start-up story before it loops`);
    assert.ok(t.layers.some((l) => l.type === "motif") || t.layers.some((l) => l.params?.finish), `${t.id} uses a motif or a clear bubble`);
  }
  const gems = story.filter((t) => t.tags.includes("gem"));
  assert.ok(gems.length >= 5, "several gem orbit buffs");
  assert.ok(new Set(gems.flatMap((t) => t.layers.filter((l) => l.type === "motif").map((l) => l.params.cut))).size >= 5, "in several cuts");
});

test("every motif in a buff is in the same place at both ends of the loop", () => {
  const nums = ["height_px", "forward_px", "side_px", "orbit_radius_px", "orbit_hz", "orbit_tilt_deg", "orbit_phase_deg", "weave_px", "bob_px", "bob_hz",
    "sway_px", "sway_hz", "stack_px", "stagger_ms", "appear_ms", "spin_hz", "yaw_deg", "tilt_deg", "roll_deg"];
  const hz = new Set(["orbit_hz", "bob_hz", "sway_hz", "spin_hz"]);
  for (const t of story) {
    const lr = t.timing.loop_range;
    for (const l of t.layers.filter((x) => x.type === "motif")) {
      const w = layerWindow(t, l);
      const loop = layerLoop(t, w);
      if (!loop) continue;
      const base = resolveParams(l.params, 7, `${l.id}#0`);
      const at = (tm) => {
        const p = { face: base.face };
        for (const k of nums) {
          let v = paramAtFrom(base, l.keyframes, k, tm, w.start);
          if (hz.has(k)) v = loopHz(v, loop);
          if (typeof v === "number") p[k] = v;
        }
        return p;
      };
      const count = Math.round(base.count ?? 1);
      for (let i = 0; i < count; i++) {
        const a = motifPlacement(at(lr.start_ms), i, count, lr.start_ms - w.start);
        const b = motifPlacement(at(lr.end_ms), i, count, lr.end_ms - w.start);
        for (const k of ["x", "y", "z", "appear"]) assert.ok(near(a[k], b[k], 1e-4), `${t.id}/${l.id}[${i}].${k}: ${a[k]} vs ${b[k]}`);
        for (const k of ["yaw", "pitch", "roll"]) {
          const d = (((b[k] - a[k]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          assert.ok(d < 1e-4 || 2 * Math.PI - d < 1e-4, `${t.id}/${l.id}[${i}].${k} turns whole turns per loop`);
        }
        for (const k of ["scale", "opacity", "bloom", "fill", "stretch"]) {
          const pa = paramAtFrom(base, l.keyframes, k, lr.start_ms, w.start);
          const pb = paramAtFrom(base, l.keyframes, k, lr.end_ms, w.start);
          assert.ok(pa === pb || near(pa, pb), `${t.id}/${l.id}.${k} is steady across the loop`);
        }
      }
    }
  }
});

test("the shapes and cuts the templates use are the ones the viewer draws", () => {
  for (const t of index) {
    for (const l of t.layers.filter((x) => x.type === "motif")) {
      assert.ok(MOTIF_SHAPES.includes(l.params.shape), `${t.id}/${l.id} shape`);
      if (l.params.shape === "gem") assert.ok(GEM_CUTS.includes(l.params.cut ?? "brilliant"), `${t.id}/${l.id} cut`);
    }
  }
  for (const cut of GEM_CUTS) assert.ok(GEM_LOOKS[cut], `${cut} has a look`);
});

test("buffs are a kind of their own in the Type list", () => {
  const g = groupCatalog(index).find((x) => x.type === "kind:buff");
  assert.ok(g, "a Buffs group");
  assert.equal(g.label, "Buffs");
  assert.deepEqual(g.templates.map((t) => t.id).sort(), buffs.map((t) => t.id).sort());
});

test("some gem buffs seal the whole character inside a crystal shell that grows up round them", () => {
  const shells = story.filter((t) => t.layers.some((l) => l.type === "motif" && l.params.shape === "gem" && l.params.encase));
  assert.ok(shells.length >= 5, `${shells.length} encasing buffs`);
  for (const t of shells) {
    const l = t.layers.find((x) => x.type === "motif" && x.params.encase);
    const w = layerWindow(t, l);
    const base = resolveParams(l.params, 7, `${l.id}#0`);
    const fill = (tm) => paramAtFrom(base, l.keyframes, "fill", tm, w.start);
    assert.ok(fill(w.start) < 0.05, `${t.id} shell starts empty`);
    assert.ok(near(fill(t.timing.loop_range.start_ms), 1), `${t.id} shell is whole when the loop starts`);
    // Tall enough to hold a standing body.
    const half = (base.size_px ?? 10) * (base.stretch ?? 1);
    assert.ok(half >= 45, `${t.id} shell is tall enough (${half})`);
  }
});
