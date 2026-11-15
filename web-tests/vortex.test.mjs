import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baseAt, centerAt, growAt, radiusAt, shapeAt, spinTurns, vortexPlan } from "../web/js/engine/vortex.js";

const tornado = JSON.parse(readFileSync(new URL("../templates/wind/tornado.json", import.meta.url), "utf8"));
const funnel = tornado.layers.find((l) => l.id === "funnel");
const plan = () => vortexPlan(tornado, funnel, 7, { x: 3.6, z: 0 }, { x: 1, z: 0 });

test("a sent vortex forms short of the target and walks to it during its travel beat", () => {
  const p = plan();
  const travel = tornado.beats.find((b) => b.phase === "travel");
  const before = baseAt(p, travel.start_ms - 10);
  const after = baseAt(p, travel.end_ms + 10);
  assert.ok(Math.abs(before.x - (3.6 - funnel.params.start_offset_px * 0.01)) < 0.15, `starts ${before.x}`);
  assert.ok(Math.abs(after.x - 3.6) < 0.15, `ends ${after.x}`);
  assert.equal(before.y, 0);
});

test("spin is integrated, so keyframed spin_hz never runs backwards", () => {
  const p = plan();
  let last = -Infinity;
  for (let t = 0; t <= tornado.timing.duration_ms; t += 25) {
    const s = spinTurns(p, t);
    assert.ok(s >= last, `turns went back at ${t}`);
    last = s;
  }
  // Spun up: faster turning during the hold than during the gather.
  const rate = (t) => (spinTurns(p, t + 50) - spinTurns(p, t)) / 0.05;
  assert.ok(rate(2000) > rate(200) * 3);
});

test("the funnel is narrow at the ground, wide at the top and pinned at its foot", () => {
  const p = plan();
  const sh = shapeAt(p, 2000);
  assert.ok(radiusAt(sh, 0) < radiusAt(sh, 0.5) && radiusAt(sh, 0.5) < radiusAt(sh, 1));
  const foot = centerAt(sh, 0);
  assert.equal(foot.x, sh.base.x);
  assert.equal(foot.z, sh.base.z);
  assert.ok(Math.abs(centerAt(sh, 1).y - sh.height) < 1e-9);
  assert.equal(growAt(p, -1), 0);
});

test("shape is a pure function of time", () => {
  assert.deepEqual(JSON.stringify(shapeAt(plan(), 1234)), JSON.stringify(shapeAt(plan(), 1234)));
});

test("the vortex lets go of what it carries when its dissipation beat starts", () => {
  const p = plan();
  assert.equal(p.release, tornado.beats.find((b) => b.phase === "dissipation").start_ms);
});
