import assert from "node:assert/strict";
import test from "node:test";
import { groundLift } from "../web/js/engine/beamground.js";

const line = (y0, y1, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: i / n, y: y0 + ((y1 - y0) * i) / n, z: 0 }));

test("a beam aimed at a target's feet is tilted up so its widest part clears the ground", () => {
  const pts = line(0.6, 0); // hand at 0.6, aimed at the ground
  const reach = (u) => 0.1 + 0.3 * u; // widens toward the target
  const lift = groundLift(pts, reach, 0.05);
  assert.ok(lift > 0);
  pts.forEach((p, i) => assert.ok(p.y >= reach(i / 10) + 0.05 - 1e-9, `point ${i} clears`));
  assert.equal(pts[0].y, 0.6, "the hand end stays put");
  // A straight tilt: still a straight line.
  const slope = pts[1].y - pts[0].y;
  pts.forEach((p, i) => assert.ok(Math.abs(p.y - (0.6 + slope * i)) < 1e-9));
});

test("a beam that already clears the ground is left alone", () => {
  const pts = line(1, 1);
  assert.equal(groundLift(pts, () => 0.2, 0.05), 0);
  assert.ok(pts.every((p) => p.y === 1));
});
