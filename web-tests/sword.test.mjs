// Sword skills: the held blade (engine/gesture.js bladeFK), the sword
// strokes, the lunge/leap/spin body moves (engine/react.js), the sweep order
// for whirlwinds (engine/splash.js) and the sword templates.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WEAPONS, armsAt, bladeFK, gestureTracks } from "../web/js/engine/gesture.js";
import { REST, combinedPose, reactionPose } from "../web/js/engine/react.js";
import { splashLayout } from "../web/js/engine/splash.js";

const root = new URL("../templates/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")).templates.map((p) => JSON.parse(readFileSync(new URL(p, root), "utf8")));
const schema = JSON.parse(readFileSync(new URL("../schemas/template-0.1.0.schema.json", import.meta.url), "utf8"));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const swords = index.filter((t) => t.tags?.includes("sword"));

test("the schema knows the slash layer, the weapons and the body moves", () => {
  assert.ok(schema.properties.layers.items.properties.type.enum.includes("slash"));
  assert.deepEqual(schema.properties.space.properties.caster_weapon.properties.kind.enum, Object.keys(WEAPONS));
  for (const k of ["lunge", "leap", "spin"]) assert.ok(schema.$defs.reaction.properties.kind.enum.includes(k), k);
});

test("the blade sits in the lead hand at its length, and a greatsword is longer", () => {
  const arms = armsAt(gestureTracks([]), 0, "blade", { kind: "sword" });
  const b = arms.blade;
  assert.ok(Math.abs(dist(b.guard, b.tip) - WEAPONS.sword.length) < 1e-9);
  assert.ok(dist(b.guard, arms.lead.palm.center) < 0.06, "guard at the fist");
  assert.ok(b.tip[1] > b.guard[1], "at rest the blade is held up");
  const big = bladeFK(arms.lead, { kind: "greatsword" });
  assert.ok(dist(big.guard, big.tip) > dist(b.guard, b.tip));
  assert.ok(Math.abs(dist(bladeFK(arms.lead, { length: 0.3 }).guard, bladeFK(arms.lead, { length: 0.3 }).tip) - 0.3) < 1e-9);
});

test("a slash sweeps the point from the lead side across the front to the off side", () => {
  const tracks = gestureTracks([{ kind: "slash", at_ms: 0, duration_ms: 400, hold_ms: 500 }]);
  const tip = (t) => armsAt(tracks, t, "blade", {}).blade.tip;
  assert.ok(tip(180)[2] < -0.3, `wound back on the lead side ${tip(180)}`);
  assert.ok(tip(300)[0] > 0.6, `out in front at 75% ${tip(300)}`);
  assert.ok(tip(400)[2] > 0.3, `followed through to the off side ${tip(400)}`);
});

test("a chop comes down, a rising slash goes up and a thrust reaches forward", () => {
  const tipAt = (kind, t) => armsAt(gestureTracks([{ kind, at_ms: 0, duration_ms: 400, hold_ms: 500 }]), t, "blade", {}).blade.tip;
  assert.ok(tipAt("chop", 220)[1] > 1.1 && tipAt("chop", 400)[1] < 0.3, "chop high then low");
  assert.ok(tipAt("rising_slash", 180)[1] < 0.2 && tipAt("rising_slash", 400)[1] > 1.1, "rising low then high");
  assert.ok(tipAt("thrust", 400)[0] > tipAt("thrust", 240)[0] + 0.3, "thrust reaches forward");
});

test("lunge steps in and back, leap lands forward, spin turns whole turns at a steady pace", () => {
  for (const kind of ["lunge", "leap", "spin"]) assert.deepEqual(reactionPose({ kind }, -1), { ...REST });
  assert.ok(reactionPose({ kind: "lunge", distance_px: 40 }, 300).push < -0.35);
  assert.ok(Math.abs(reactionPose({ kind: "lunge" }, 600).push) < 1e-9);
  assert.ok(reactionPose({ kind: "leap", lift_px: 50 }, 245).lift > 0.45);
  assert.ok(Math.abs(reactionPose({ kind: "leap", distance_px: 80 }, 700).push + 0.8) < 1e-9);
  const yaw = (ms) => reactionPose({ kind: "spin", turns: -2, duration_ms: 1000 }, ms).yaw;
  assert.ok(Math.abs(yaw(1000) + 4 * Math.PI) < 1e-9);
  const a = yaw(400) - yaw(300);
  const b = yaw(700) - yaw(600);
  assert.ok(Math.abs(a - b) < 1e-9, "steady between the ramps");
  const both = combinedPose([{ kind: "lunge" }, { kind: "spin" }], [0, 100], 300);
  assert.ok(both.push < 0 && both.yaw > 0);
});

test("sweep order hits each enemy in turn round the circle within one turn", () => {
  const space = { destination: "caster", targets: { layout: "splash", count: 6, radius: 1.3, order: "sweep", sweep_ms: 400, sweep_start_deg: -90 } };
  const lay = splashLayout(space, 7);
  assert.ok(lay.delays.every((d) => d >= 0 && d < 400));
  const angle = (p) => (((Math.atan2(p.z, p.x) + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const order = lay.others.map((p, i) => [angle(p), lay.delays[i]]).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i][1] >= order[i - 1][1]);
});

test("every sword skill holds a weapon, swings it and draws a slash or a blade effect", () => {
  assert.ok(swords.length >= 10);
  for (const t of swords) {
    assert.ok(t.space.caster_weapon?.kind, `${t.id} holds a weapon`);
    assert.ok(t.space.caster_gestures?.length, `${t.id} gestures`);
    assert.ok(t.layers.some((l) => l.type === "slash"), `${t.id} has a slash trail`);
    assert.equal(t.line, "Swordsmanship", t.id);
  }
});

test("a maul is a long haft with its head at the end, and caster_blade sits in the head", () => {
  const arms = armsAt(gestureTracks([]), 0, "blade", { kind: "maul" });
  const b = arms.blade;
  assert.ok(Math.abs(dist(b.guard, b.tip) - WEAPONS.maul.length) < 1e-9);
  assert.ok(b.head > 0, "the maul has a head");
  assert.ok(Math.abs(dist(b.mid, b.tip) - WEAPONS.maul.head / 2) < 1e-9, "caster_blade is the middle of the head");
  // A sword's caster_blade stays the middle of the blade.
  const s = bladeFK(arms.lead, { kind: "sword" });
  assert.ok(Math.abs(dist(s.guard, s.mid) - WEAPONS.sword.length * 0.55) < 1e-9);
});

test("the maul slam lifts the head overhead and brings it down to the ground in front", () => {
  const t = index.find((x) => x.id === "physical-anvilfall");
  assert.ok(t, "anvilfall is in the index");
  assert.equal(t.space.caster_weapon.kind, "maul");
  assert.ok(t.space.caster_gestures?.length, "the caster swings it");
  const tracks = gestureTracks(t.space.caster_gestures);
  const head = (ms) => armsAt(tracks, ms, "blade", t.space.caster_weapon).blade.mid;
  assert.ok(head(520)[1] > 1.0, `overhead at the hang ${head(520)}`);
  assert.ok(head(820)[1] < 0.25 && head(820)[0] > 0.6, `down in front at the smash ${head(820)}`);
});
