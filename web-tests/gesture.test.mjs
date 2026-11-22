// Arms, hands and casting gestures (engine/gesture.js): the arm holds
// together in every pose, gestures move the hands where they say, poses
// change smoothly, the caster's rest hand stays where `caster_hand` always
// was, and the templates' gestures line up with their casts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BODY,
  GESTURE_KINDS,
  HAND_ANCHORS,
  HAND_SHAPES,
  armFK,
  armPose,
  armsAt,
  gestureInfo,
  gestureTracks,
  reactionGestures,
} from "../web/js/engine/gesture.js";
import { REACTION_KINDS } from "../web/js/engine/react.js";

const root = new URL("../templates/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")).templates.map((p) => JSON.parse(readFileSync(new URL(p, root), "utf8")));
const schema = JSON.parse(readFileSync(new URL("../schemas/template-0.1.0.schema.json", import.meta.url), "utf8"));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finite = (v) => v.every(Number.isFinite);

test("the schema lists every gesture, hand shape and hand anchor the viewer knows", () => {
  assert.deepEqual(schema.$defs.gesture.properties.kind.enum, GESTURE_KINDS);
  assert.deepEqual(schema.$defs.gesture.properties.shape.enum, Object.keys(HAND_SHAPES));
  for (const a of HAND_ANCHORS) assert.ok(schema.$defs.anchor.enum.includes(a), a);
  for (const k of GESTURE_KINDS) assert.ok(gestureInfo(k).duration_ms > 0, k);
});

test("every gesture's end pose keeps the arm in one piece, hands on the right side", () => {
  for (const kind of GESTURE_KINDS) {
    for (const hand of ["lead", "off", "both"]) {
      const arms = armsAt(gestureTracks([{ kind, hand, at_ms: 0, hold_ms: 5000 }]), 2000, "ready");
      for (const [side, fk] of [["lead", arms.lead], ["off", arms.off]]) {
        assert.ok(Math.abs(dist(fk.shoulder, fk.elbow) - BODY.upper) < 1e-6, `${kind}/${hand}/${side} upper arm`);
        assert.ok(Math.abs(dist(fk.elbow, fk.wrist) - BODY.fore) < 1e-6, `${kind}/${hand}/${side} forearm`);
        assert.ok(finite(fk.hand) && finite(fk.tip), `${kind}/${hand}/${side} finite`);
        for (const f of fk.fingers) for (const p of f) assert.ok(finite(p));
        // Hands stay off the floor and within arm's reach of their shoulder.
        assert.ok(fk.hand[1] > 0.1 && fk.hand[1] < 1.4, `${kind} ${side} hand height ${fk.hand[1]}`);
      }
      // Clapped hands meet in the middle; otherwise the lead hand is on its side.
      if (kind !== "clap" && kind !== "spin_throw" && kind !== "throw") assert.ok(arms.lead.hand[2] < 0.06, `${kind}/${hand}: lead hand on -Z (${arms.lead.hand[2]})`);
    }
  }
});

test("at rest the caster's hand is where caster_hand always was, and the off arm hangs", () => {
  const arms = armsAt(gestureTracks([]), 0, "ready");
  assert.ok(dist(arms.lead.hand, [0.28, 0.68, -0.22]) < 0.05, `rest hand ${arms.lead.hand}`);
  assert.ok(arms.off.hand[1] < 0.4 && arms.off.hand[2] > 0.15, `off hand hangs ${arms.off.hand}`);
});

test("a throw winds the hand back behind the head and releases it out in front at its end", () => {
  const tracks = gestureTracks([{ kind: "throw", at_ms: 100, duration_ms: 500 }]);
  const wind = armsAt(tracks, 100 + 0.6 * 500, "ready").lead.hand;
  const release = armsAt(tracks, 600, "ready").lead.hand;
  assert.ok(wind[0] < 0 && wind[1] > 0.85, `wound back ${wind}`);
  assert.ok(release[0] > 0.3, `released in front ${release}`);
  // Then it eases back to rest.
  assert.ok(dist(armsAt(tracks, 5000, "ready").lead.hand, armsAt(tracks, 0, "ready").lead.hand) < 1e-9);
});

test("raise lifts the hand overhead; slam drives both fists down; point straightens the index finger", () => {
  const at = (g, t = 2000) => armsAt(gestureTracks([{ at_ms: 0, hold_ms: 9000, ...g }]), t, "ready");
  assert.ok(at({ kind: "raise" }).lead.hand[1] > 1.05);
  assert.ok(at({ kind: "raise", hand: "off" }).off.hand[1] > 1.05);
  const slam = at({ kind: "slam" });
  assert.ok(slam.lead.hand[1] < 0.45 && slam.off.hand[1] < 0.45);
  const p = at({ kind: "point" }).lead;
  const reach = (i) => dist(p.fingers[i][2], p.wrist);
  assert.ok(reach(1) > reach(2) + 0.03, "index out further than the curled middle finger");
  assert.ok(dist(p.tip, p.fingers[1][2]) < 1e-12);
});

test("poses change smoothly: no jumps between frames, even when one gesture cuts into another", () => {
  const tracks = gestureTracks([
    { kind: "hold_orb", at_ms: 0, duration_ms: 200, hold_ms: 0 },
    { kind: "spin_throw", at_ms: 120, duration_ms: 400 },
    { kind: "roar", at_ms: 700, duration_ms: 300 },
    { kind: "rest", at_ms: 900 },
  ]);
  let prev = armsAt(tracks, -10, "ready");
  for (let t = -2; t < 2500; t += 2) {
    const cur = armsAt(tracks, t, "ready");
    for (const s of ["lead", "off"]) assert.ok(dist(cur[s].hand, prev[s].hand) < 0.05, `${s} jumps at ${t} ms`);
    prev = cur;
  }
});

test("a figure's reaction moves its arms (and they settle back)", () => {
  for (const kind of REACTION_KINDS) {
    const g = reactionGestures({ kind }, 100);
    assert.ok(g.length >= 1, kind);
    for (const x of g) assert.ok(GESTURE_KINDS.includes(x.kind));
    const tracks = gestureTracks(g);
    const rest = armsAt(tracks, 0, "hang").lead.hand;
    let moved = 0;
    for (let t = 100; t < 1200; t += 20) moved = Math.max(moved, dist(armsAt(tracks, t, "hang").lead.hand, rest));
    assert.ok(moved > 0.2, `${kind} moves the arms (${moved})`);
    assert.ok(dist(armsAt(tracks, 9000, "hang").lead.hand, rest) < 1e-9, `${kind} settles`);
  }
  assert.deepEqual(reactionGestures(null), []);
});

test("unknown gestures and hands are ignored, and an arm with nothing to do rests", () => {
  const tracks = gestureTracks([{ kind: "moonwalk" }, { kind: "raise", hand: "tail" }]);
  assert.equal(tracks.off.length, 0);
  assert.equal(tracks.lead.length, 1);
  assert.deepEqual(armPose([], "hang", 100), armPose(null, "hang", 0));
  assert.ok(armFK(armPose([], "hang", 0), 1).hand[2] > 0);
});

test("spells thrown from the hand let go of it in front of the body", () => {
  const thrown = index.filter((t) => t.space.origin === "caster_hand" && t.space.travel === "projectile" && t.space.caster_gestures);
  assert.ok(thrown.length >= 10);
  for (const t of thrown) {
    const tracks = gestureTracks(t.space.caster_gestures);
    const travel = t.beats.filter((b) => b.phase === "travel").sort((a, b) => a.start_ms - b.start_ms)[0];
    const hand = armsAt(tracks, travel.start_ms, "ready").lead.hand;
    assert.ok(hand[0] > 0.15, `${t.id}: hand at ${hand.map((v) => v.toFixed(2))} when the flight starts`);
  }
});

test("every spell with a caster gestures, and its gestures start within the spell", () => {
  for (const t of index) {
    if (t.archetype === "status") {
      assert.equal(t.space.caster_gestures, undefined, `${t.id}: a status effect has no caster`);
      continue;
    }
    const g = t.space.caster_gestures;
    assert.ok(Array.isArray(g) && g.length, `${t.id} has caster_gestures`);
    for (const x of g) {
      assert.ok(GESTURE_KINDS.includes(x.kind), `${t.id}: ${x.kind}`);
      assert.ok(x.at_ms >= 0 && x.at_ms < t.timing.duration_ms, `${t.id}: ${x.kind} at ${x.at_ms}`);
    }
  }
});

test("the export lists the caster's gestures as its casting animation", async () => {
  const { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet } = await import("../web/js/engine/spritesheet.js");
  const t = index.find((x) => x.id === "lightning-stormhammer-barrage");
  const plan = framePlan(t);
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count, layout: layoutSheet(plan.count, 1, { frame: 64 }) }];
  const m = buildManifest({ template: t, seed: 1, plan, sheets, visible: {}, views: { front: { pivots: {}, px_per_unit: 30 } }, tracks: buildTracks(t, 1, plan, { cues: {} }), frame: 64 });
  assert.deepEqual(m.caster_gestures, t.space.caster_gestures);
  const md = guideMarkdown(m);
  assert.ok(md.includes("## Casting animation") && md.includes("`spin_throw`"));
});
