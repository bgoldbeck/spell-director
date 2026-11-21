// Warcries: shouts that roll out over the allies or enemies round the
// caster. These check the stand-ins' reactions (engine/react.js), that the
// warcry templates line their reactions up with their waves and loops, the
// Warcries kind, and the export's reaction notes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REACTION_KINDS, REST, reactionPose } from "../web/js/engine/react.js";
import { splashLayout } from "../web/js/engine/splash.js";
import { MOTIF_SHAPES } from "../web/js/engine/motifplace.js";
import { groupCatalog, isWarcry } from "../web/js/catalog.js";
import { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet, spriteLayers } from "../web/js/engine/spritesheet.js";

const root = new URL("../templates/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")).templates.map((p) => JSON.parse(readFileSync(new URL(p, root), "utf8")));
const warcries = index.filter(isWarcry);
const byId = (id) => index.find((t) => t.id === id);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const isRest = (p) => near(p.push, 0) && near(p.lean, 0) && near(p.lift, 0) && near(p.squash, 1) && near(p.shiver, 0);

test("before a reaction starts, and with no reaction, a figure stands at rest", () => {
  for (const kind of REACTION_KINDS) assert.ok(isRest(reactionPose({ kind }, -1)), kind);
  assert.deepEqual(reactionPose(null, 100), { ...REST });
  assert.deepEqual(reactionPose({ kind: "moonwalk" }, 100), { ...REST });
});

test("knockback shoves a figure back, tips it back mid-flight and lands it upright where it was pushed", () => {
  const r = { kind: "knockback", distance_px: 100, duration_ms: 500 };
  const mid = reactionPose(r, 200);
  assert.ok(mid.push > 0.5 && mid.push < 1, `pushed ${mid.push}`);
  assert.ok(mid.lean > 0.2, "tipped back");
  assert.ok(mid.lift > 0, "a little hop");
  const end = reactionPose(r, 500);
  const later = reactionPose(r, 2000);
  assert.ok(near(end.push, 1) && near(later.push, 1), "stays one unit back");
  assert.ok(near(later.lean, 0) && near(later.lift, 0), "upright and on the ground");
  // The push only grows.
  let last = 0;
  for (let ms = 0; ms <= 500; ms += 25) {
    const p = reactionPose(r, ms).push;
    assert.ok(p >= last - 1e-9);
    last = p;
  }
});

test("flinch, cower, cheer and shout all come back to rest when they end", () => {
  for (const kind of ["flinch", "cower", "cheer", "shout"]) {
    const r = { kind, duration_ms: 800, distance_px: 0 };
    assert.ok(isRest(reactionPose(r, 800)), `${kind} at its end`);
    assert.ok(isRest(reactionPose(r, 5000)), `${kind} long after`);
    let moved = 0;
    for (let ms = 0; ms < 800; ms += 20) {
      const p = reactionPose(r, ms);
      moved = Math.max(moved, Math.abs(p.lean), p.lift, Math.abs(1 - p.squash));
    }
    assert.ok(moved > 0.04, `${kind} visibly moves (${moved})`);
  }
});

test("cower crouches and trembles; cheer hops; the shout rears back, then throws the chest forward", () => {
  const cower = reactionPose({ kind: "cower", duration_ms: 2000 }, 1000);
  assert.ok(cower.squash < 0.85 && cower.lean > 0);
  const cheer = { kind: "cheer", duration_ms: 600, hops: 2, lift_px: 20 };
  assert.ok(near(reactionPose(cheer, 150).lift, 0.2), "top of the first hop");
  assert.ok(reactionPose(cheer, 300).lift < 0.01, "lands between hops");
  const shout = { kind: "shout", duration_ms: 1000 };
  assert.ok(reactionPose(shout, 380).lean > 0.15, "rears back drawing breath");
  assert.ok(reactionPose(shout, 600).lean < -0.15, "chest forward on the shout");
});

test("there are warcries, each a point-blank splash with a shouting caster and reacting figures", () => {
  assert.ok(warcries.length >= 6, `${warcries.length} warcries`);
  for (const t of warcries) {
    const s = t.space;
    assert.equal(s.destination, "caster", t.id);
    assert.equal(s.targets.layout, "splash", t.id);
    assert.ok(["allies", "enemies"].includes(s.targets.side), `${t.id} says who stands round the caster`);
    assert.ok(REACTION_KINDS.includes(s.targets.react?.kind), `${t.id} targets react`);
    assert.equal(s.caster_react?.kind, "shout", t.id);
    assert.ok(t.layers.some((l) => l.anchor === "splash"), `${t.id} has per-figure layers`);
  }
  const sides = new Set(warcries.map((t) => t.space.targets.side));
  assert.deepEqual([...sides].sort(), ["allies", "enemies"]);
});

test("a warcry's release starts at the shout's chest-forward moment", () => {
  for (const t of warcries) {
    const c = t.space.caster_react;
    const forward = (c.at_ms ?? 0) + 0.4 * (c.duration_ms ?? 900);
    const release = Math.min(...t.beats.filter((b) => b.phase === "impact" || b.phase === "release").map((b) => b.start_ms));
    assert.ok(Math.abs(release - forward) <= 140, `${t.id}: release at ${release}, chest forward at ${forward}`);
  }
});

test("warcry auras keep every per-figure layer in step with the loop and finish reacting first", () => {
  for (const t of warcries.filter((x) => x.timing.loop_range)) {
    const { delays } = splashLayout(t.space, 5);
    assert.ok(delays.every((d) => d === 0), `${t.id}: ripple_ms 0`);
    const r = t.space.targets.react;
    assert.ok((r.at_ms ?? 0) + (r.duration_ms ?? 0) <= t.timing.loop_range.start_ms, `${t.id}: reaction over before the loop`);
  }
});

test("the roar's knockback lands as its ring passes each enemy", () => {
  const t = byId("sound-warcry-breaker-roar");
  const ring = t.layers.find((l) => l.id === "roar-wall");
  const beats = ring.beats.map((id) => t.beats.find((b) => b.id === id));
  const start = Math.min(...beats.map((b) => b.start_ms));
  const end = Math.max(...beats.map((b) => b.end_ms));
  const speed = (ring.params.end_radius_px - ring.params.start_radius_px) / 100 / ((end - start) / 1000); // units per second
  const { others, delays } = splashLayout(t.space, 9);
  others.forEach((p, k) => {
    const reached = start + ((Math.hypot(p.x, p.z) - ring.params.start_radius_px / 100) / speed) * 1000;
    const hit = t.space.targets.react.at_ms + delays[k];
    assert.ok(Math.abs(hit - reached) < 120, `enemy ${k}: hit at ${hit}, ring at ${reached}`);
  });
});

test("warcries are a kind of their own in the Type list, and the banner is a motif", () => {
  const g = groupCatalog(index).find((x) => x.type === "kind:warcry");
  assert.ok(g);
  assert.equal(g.label, "Warcries");
  assert.deepEqual(g.templates.map((t) => t.id).sort(), warcries.map((t) => t.id).sort());
  assert.ok(MOTIF_SHAPES.includes("banner"));
  assert.ok(byId("light-warcry-rallying-standard").layers.some((l) => l.type === "motif" && l.params.shape === "banner"));
});

test("the export tells the engine who stands round the caster and how everyone reacts", () => {
  const t = byId("sound-warcry-breaker-roar");
  const plan = framePlan(t);
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count, layout: layoutSheet(plan.count, 1, { frame: 64 }) }];
  const visible = Object.fromEntries(spriteLayers(t).map((l) => [l.id, null]));
  const m = buildManifest({ template: t, seed: 1, plan, sheets, visible, views: { front: { pivots: {}, px_per_unit: 30 } }, tracks: buildTracks(t, 1, plan, { cues: {} }), frame: 64 });
  assert.equal(m.reactions.side, "enemies");
  assert.equal(m.reactions.targets.kind, "knockback");
  assert.equal(m.reactions.caster.kind, "shout");
  const md = guideMarkdown(m);
  assert.ok(md.includes("## Character reactions") && md.includes("`knockback`"));
  const plain = byId("sound-shattering-refrain");
  const mp = buildManifest({ template: plain, seed: 1, plan: framePlan(plain), sheets, visible: {}, views: { front: { pivots: {}, px_per_unit: 30 } }, tracks: buildTracks(plain, 1, framePlan(plain), { cues: {} }), frame: 64 });
  assert.equal(mp.reactions, null, "no reactions section for a spell without them");
});
