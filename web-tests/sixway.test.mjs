import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { SIXWAY_FRAMES, bakeSixWay, sixwayFrame, sixwayLight, sixwayTexel, smokeLighting } from "../web/js/engine/sixway.js";
import { encodePng } from "../web/js/engine/png.js";
import { lightOffset } from "../web/js/engine/lights.js";
import { buildManifest, buildSixWay, buildTracks, framePlan, guideMarkdown } from "../web/js/engine/spritesheet.js";
import { engineRecipe } from "../web/js/engine/shader.js";
import { resolveStyle } from "../web/js/engine/style.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const campfire = load("../templates/fire/neon-campfire.json");
const pyre = load("../templates/fire/pyre-ward.json");

const bake = bakeSixWay({ size: 32, frames: 4 });

// Average of a map over the puff's opaque texels in a part of frame 0.
function avg(key, inPart) {
  let sum = 0, n = 0;
  for (let y = 0; y < bake.size; y++) {
    for (let x = 0; x < bake.size; x++) {
      const t = sixwayTexel(bake, x, y);
      if (t.alpha < 0.3 || !inPart(x, y)) continue;
      sum += t[key];
      n++;
    }
  }
  return sum / n;
}

test("bake: a grid of frames, two RGBA maps, deterministic", () => {
  assert.equal(bake.cols, 2);
  assert.equal(bake.rows, 2);
  assert.equal(bake.width, 64);
  assert.equal(bake.pos.length, 64 * 64 * 4);
  assert.equal(bake.neg.length, 64 * 64 * 4);
  assert.deepEqual(bakeSixWay({ size: 32, frames: 4 }).pos, bake.pos);
  assert.notDeepEqual(bakeSixWay({ size: 32, frames: 4, seed: 9 }).pos, bake.pos);
  // The puff is in the middle of its frame, with clear edges.
  assert.ok(sixwayTexel(bake, 16, 16).alpha > 0.5);
  assert.equal(sixwayTexel(bake, 0, 0).alpha, 0);
});

test("bake: each map is brightest on the side its light comes from", () => {
  const h = bake.size / 2;
  const right = (x) => x >= h + 4, left = (x) => x < h - 4;
  const top = (x, y) => y < h - 4, bottom = (x, y) => y >= h + 4;
  assert.ok(avg("right", right) > avg("right", left) + 0.1, "right map");
  assert.ok(avg("left", left) > avg("left", right) + 0.1, "left map");
  assert.ok(avg("top", top) > avg("top", bottom) + 0.1, "top map");
  assert.ok(avg("bottom", bottom) > avg("bottom", top) + 0.1, "bottom map");
  // Lit from the camera's side the puff is brighter overall than lit from behind.
  const all = () => true;
  assert.ok(avg("front", all) > avg("back", all), "front vs back");
});

test("sixwayLight: weights sum to one and pick the side the light is on", () => {
  const m = { right: 1, left: 0, top: 0.5, bottom: 0.25, front: 0.8, back: 0.1 };
  assert.equal(sixwayLight([1, 0, 0], m), 1);
  assert.equal(sixwayLight([-1, 0, 0], m), 0);
  assert.equal(sixwayLight([0, -1, 0], m), 0.25);
  assert.equal(sixwayLight([0, 0, -1], m), 0.1);
  const flat = { right: 1, left: 1, top: 1, bottom: 1, front: 1, back: 1 };
  const d = [0.48, -0.6, 0.64];
  assert.ok(Math.abs(sixwayLight(d, flat) - 1) < 1e-9);
  assert.equal(sixwayFrame(0), 0);
  assert.equal(sixwayFrame(1), SIXWAY_FRAMES - 1);
});

test("smokeLighting: intent first, then the realistic style for alpha smoke", () => {
  const realistic = resolveStyle(pyre, "realistic");
  const stylized = resolveStyle(pyre, "stylized");
  const smoke = { type: "smoke", blend: "alpha" };
  assert.equal(smokeLighting(smoke, stylized, { lighting: "lit" }), "flat");
  assert.equal(smokeLighting(smoke, realistic, { lighting: "lit" }), "six_way");
  assert.equal(smokeLighting(smoke, realistic, { lighting: "unlit" }), "flat");
  assert.equal(smokeLighting(smoke, stylized, { lighting: "six_way" }), "six_way");
  assert.equal(smokeLighting({ type: "smoke", blend: "add" }, realistic, { lighting: "lit" }), "flat");
  assert.equal(smokeLighting({ type: "sparks" }, realistic, { lighting: "six_way" }), "flat");
});

test("export: six-way smoke layers get their maps, recipe and guide section", () => {
  const plan = framePlan(campfire, { fps: 10 });
  const style = resolveStyle(campfire);
  const list = buildSixWay(campfire, 1, style);
  assert.deepEqual(list.map((w) => w.layer), ["smoke-column"]);
  assert.equal(list[0].positive_map, "smoke-smoke-column-sixway-pos.png");
  assert.equal(list[0].columns * list[0].rows, list[0].frames);
  // Realistic lights the pyre's dark smoke too, but not its flame billows.
  assert.deepEqual(buildSixWay(pyre, 1, resolveStyle(pyre, "realistic")).map((w) => w.layer), ["pyre-smoke"]);
  assert.deepEqual(buildSixWay(pyre, 1, resolveStyle(pyre, "stylized")), []);

  const tracks = buildTracks(campfire, 1, plan);
  const sheets = [{ id: "all", first: 0, count: plan.count, layout: { width: 1, height: 1, columns: 1, rows: 1, blocks: 1 } }];
  const m = buildManifest({ template: campfire, seed: 1, plan, sheets, visible: {}, views: { side: {} }, tracks, frame: 64, style });
  assert.equal(m.six_way_smoke.length, 1);
  const layer = m.layers.find((l) => l.id === "smoke-column");
  assert.equal(layer.shader.lighting, "six_way");
  assert.ok(layer.engine_hints.unity.some((x) => x.includes("Six-way Smoke Lit")));
  const md = guideMarkdown(m, { files: [] });
  assert.ok(md.includes("## Six-way lit smoke"));
  assert.ok(md.includes("smoke-smoke-column-sixway-neg.png"));

  // Lights carry their tint, offset and orbit.
  const magenta = tracks.lights.find((l) => l.layer === "magenta-right");
  assert.equal(magenta.color, "#FF2BD6");
  assert.deepEqual(magenta.offset_units, [2.2, 1.5, -0]);
  assert.ok(tracks.lights.find((l) => l.layer === "orbit-cyan").orbit_hz > 0);
  assert.ok(engineRecipe({ type: "smoke" }, { technique: "flipbook", lighting: "six_way" }, "alpha").godot.some((x) => x.includes("DIFFUSE_LIGHT")));
});

test("lightOffset: forward, side (left), height and an orbit counter-clockwise from above", () => {
  assert.deepEqual(lightOffset({}, 0), [0, 80, -0]);
  assert.deepEqual(lightOffset({ forward: 100, height: -50 }, 0), [100, -50, -0]);
  const [x, , z] = lightOffset({ side: 100 }, 0);
  assert.ok(Math.abs(x) < 1e-9 && z === -100); // left of +X is -Z
  const [qx, , qz] = lightOffset({ forward: 100, orbit_hz: 1 }, 250); // a quarter turn
  assert.ok(Math.abs(qx) < 1e-9 && Math.abs(qz + 100) < 1e-9);
});

test("the campfire's lights take turns from all six directions", () => {
  const lights = campfire.layers.filter((l) => l.type === "light" && l.id !== "firelight" && !l.id.startsWith("orbit"));
  const dirs = lights.map((l) => {
    const p = l.params;
    return [Math.sign(p.forward_px || 0), Math.sign((p.height_px ?? 80) - 150), Math.sign(p.side_px || 0)].join();
  });
  assert.equal(new Set(dirs).size, 6);
  assert.ok(lights.every((l) => /^#[0-9A-F]{6}$/i.test(l.params.tint)));
});

test("encodePng: a valid RGBA PNG that keeps color under zero alpha", async () => {
  const rgba = new Uint8Array([10, 20, 30, 0, 200, 100, 50, 255, 1, 2, 3, 4, 5, 6, 7, 8]);
  const png = await encodePng(2, 2, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  assert.equal(view.getUint32(16), 2);
  assert.equal(png[25], 6); // RGBA
  const idatLen = view.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.deepEqual([...raw], [0, 10, 20, 30, 0, 200, 100, 50, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
