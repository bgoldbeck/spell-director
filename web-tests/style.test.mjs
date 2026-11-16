import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DECAL_FILLS, STYLES, STYLE_IDS, decalRender, outline, pixelate, posterize, resolveStyle, shaderForStyle, styleCell,
  styleGuideLines, styleRecipe,
} from "../web/js/engine/style.js";
import { decalFillState, decalPlan } from "../web/js/engine/decal.js";
import { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet } from "../web/js/engine/spritesheet.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const meteor = load("../templates/fire/meteor-strike.json");
const sky = load("../templates/lightning/sky-strike.json");

test("every style has a label, a look, viewer settings and Unity and Godot steps", () => {
  assert.deepEqual(STYLE_IDS, ["stylized", "realistic", "toon", "pixel"]);
  for (const id of STYLE_IDS) {
    const s = STYLES[id];
    assert.ok(s.label && s.about && s.look, id);
    assert.ok(s.unity.length && s.godot.length, id);
    assert.ok(["flat", "depth", "bands"].includes(s.view.decal), id);
  }
});

test("resolveStyle: the override wins, then the template's preset, then stylized", () => {
  assert.equal(resolveStyle(sky).id, "stylized");
  assert.equal(resolveStyle(sky).from, "default");
  assert.equal(resolveStyle(sky, "toon").id, "toon");
  assert.equal(resolveStyle(sky, "nonsense").id, "stylized");
  const t = { ...sky, style: { preset: "realistic", depth: 0.9, saturation: 0.7, notes: "gritty" } };
  const r = resolveStyle(t);
  assert.equal(r.id, "realistic");
  assert.equal(r.from, "template");
  assert.equal(r.depth, 0.9);
  assert.equal(r.view.saturation, 0.7);
  assert.equal(r.notes, "gritty");
  // Knobs for the template's preset don't leak into another style.
  const other = resolveStyle(t, "toon");
  assert.equal(other.view.saturation, STYLES.toon.view.saturation);
  assert.equal(other.notes, "");
  // The preset table itself is never mutated.
  assert.notEqual(STYLES.realistic.view.saturation, 0.7);
});

test("shaderForStyle merges a layer's per-style refinement over its intent", () => {
  const sh = { material: "molten", look: "base", noise: { type: "fbm", scale: 3 }, styles: { realistic: { look: "real", noise: { scale: 6 } } } };
  assert.deepEqual(shaderForStyle(sh, "realistic"), { material: "molten", look: "real", noise: { type: "fbm", scale: 6 } });
  assert.deepEqual(shaderForStyle(sh, "toon"), { material: "molten", look: "base", noise: { type: "fbm", scale: 3 } });
});

test("decalRender: realistic carves cracks and puts the light of glowing cracks in them", () => {
  const real = resolveStyle(sky, "realistic");
  const flat = resolveStyle(sky, "stylized");
  const glowing = decalRender("cracks", "add", {}, real, "primary");
  assert.equal(glowing.mode, "depth");
  assert.ok(glowing.depth > 0);
  assert.equal(glowing.fill, "glow");
  assert.equal(glowing.fill_color, "primary");
  // A barely carved hot burn stays flat light; warning rings stay flat.
  assert.equal(decalRender("burn", "add", {}, real).mode, "flat");
  assert.equal(decalRender("warning_ring", "add", {}, real).mode, "flat");
  // Frost is raised.
  assert.ok(decalRender("frost", "alpha", {}, real).depth < 0);
  // Stylized: no depth, plain material unless there's a fill.
  assert.equal(decalRender("cracks", "add", {}, flat).custom, false);
  const lava = decalRender("cracks", "add", { fill: "lava" }, flat);
  assert.equal(lava.custom, true);
  assert.equal(lava.fill_color, DECAL_FILLS.lava.color);
  assert.equal(decalRender("cracks", "alpha", {}, resolveStyle(sky, "toon")).mode, "bands");
});

test("a decal's fill rises over fill_in_ms and cools while it fades", () => {
  const layer = meteor.layers.find((l) => l.id === "molten-cracks");
  const plan = decalPlan(meteor, layer, 1);
  assert.equal(plan.look.fill, "lava");
  assert.deepEqual(decalFillState(plan, plan.start_ms - 1, 250), { amount: 0, heat: 1 });
  assert.equal(decalFillState(plan, plan.start_ms + 125, 250).amount, 0.5);
  assert.equal(decalFillState(plan, plan.hold_until_ms, 250).heat, 1);
  const mid = decalFillState(plan, plan.hold_until_ms + plan.fade_out_ms / 2, 250).heat;
  assert.ok(mid > 0 && mid < 1);
  assert.equal(decalFillState(plan, plan.end_ms, 250).heat, 0);
});

test("styleRecipe adds per-style engine steps; the manifest and guide carry the style", () => {
  const decal = meteor.layers.find((l) => l.id === "molten-cracks");
  const r = styleRecipe("realistic", decal, decal.params);
  assert.ok(r.unity.some((x) => x.includes("Parallax Occlusion Mapping")));
  assert.ok(r.unity.some((x) => x.includes("lava")));
  assert.ok(r.godot.length >= 2);
  assert.deepEqual(styleRecipe("stylized", { type: "bolt" }), { unity: [], godot: [] });

  const plan = framePlan(meteor, { fps: 10 });
  const style = resolveStyle(meteor, "realistic");
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count, layout: layoutSheet(plan.count, 1, { frame: 64 }) }];
  const views = { front: { pivots: {}, px_per_unit: 40 } };
  const m = buildManifest({ template: meteor, seed: 1, plan, sheets, visible: {}, views, tracks: buildTracks(meteor, 1, plan), frame: 64, style });
  assert.equal(m.style.id, "realistic");
  const d = m.decals.find((x) => x.layer === "molten-cracks");
  assert.equal(d.fill, "lava");
  assert.equal(d.height_map, "decal-molten-cracks-height.png");
  assert.equal(d.emissive_mask, "decal-molten-cracks-emissive.png");
  assert.equal(d.flow_map, "decal-molten-cracks-flow.png");
  assert.equal(d.curves.heat.length, plan.count);
  const l = m.layers.find((x) => x.id === "molten-cracks");
  assert.match(l.shader.look, /ground splits open/);
  assert.ok(l.engine_hints.unity.some((x) => x.startsWith("Realistic:")));
  const guide = guideMarkdown(m, { files: [] });
  assert.match(guide, /## Style: Realistic/);
  assert.match(guide, /### Depth and fills/);
  assert.ok(styleGuideLines(style).length > 5);

  // Stylized: no depth maps for plain glowing cracks.
  const flat = buildManifest({ template: sky, seed: 1, plan: framePlan(sky), sheets, visible: {}, views, frame: 64 });
  assert.equal(flat.style.id, "stylized");
  assert.ok(flat.decals.every((x) => x.height_map === null && x.emissive_mask === null));
});

test("toon and pixel cells: posterized, hard-edged, inked, chunky", () => {
  const size = 8;
  const img = new Uint8ClampedArray(size * size * 4);
  // A solid 2x2 block in the middle, a faint pixel off to the side.
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) img.set([200, 100, 40, 255], (y * size + x) * 4);
  img.set([255, 255, 255, 20], (0 * size + 7) * 4);
  const toon = styleCell(new Uint8ClampedArray(img), size, STYLES.toon.view, [1, 2, 3]);
  assert.equal(toon[(0 * size + 7) * 4 + 3], 0, "faint tail drops out");
  assert.deepEqual([...toon.slice((2 * size + 3) * 4, (2 * size + 3) * 4 + 3)], [1, 2, 3], "ink next to the shape");
  const p = posterize(new Uint8ClampedArray([130, 10, 250, 200]), 3);
  assert.ok([0, 128, 255].includes(Math.round(p[0])));
  const px = pixelate(new Uint8ClampedArray(img), size, 4);
  assert.deepEqual([...px.slice((0 * size + 0) * 4, 4)], [...px.slice((3 * size + 3) * 4, (3 * size + 3) * 4 + 4)]);
  assert.ok(outline(new Uint8ClampedArray(img), size, 1, [0, 0, 0]) instanceof Uint8ClampedArray);
});
