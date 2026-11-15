import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DECAL_SHAPES, decalBlend, decalPlan, decalState } from "../web/js/engine/decal.js";
import { buildDecals, buildManifest, buildTracks, framePlan, guideMarkdown } from "../web/js/engine/spritesheet.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const schema = load("../schemas/template-0.1.0.schema.json");

const tpl = (params, extra = {}) => ({
  timing: { duration_ms: 1000 },
  space: {},
  beats: [
    { id: "hit", phase: "impact", start_ms: 200, end_ms: 400 },
    { id: "fade", phase: "dissipation", start_ms: 400, end_ms: 800 },
  ],
  layers: [{ id: "mark", type: "decal", beats: ["hit", "fade"], params, ...extra }],
});

test("every decal shape in the schema has a renderer entry and a default blend", () => {
  const shapes = schema.properties.layers.items.allOf[0].then.properties.params.properties.shape.enum;
  assert.deepEqual([...shapes].sort(), Object.keys(DECAL_SHAPES).sort());
  assert.equal(decalBlend({ params: { shape: "rune_circle" } }), "add");
  assert.equal(decalBlend({ params: { shape: "scorch" } }), "alpha");
  assert.equal(decalBlend({ blend: "add", params: { shape: "cracks" } }), "add");
});

test("a decal fades in, holds through its beats and fades out", () => {
  const t = tpl({ shape: "scorch", fade_in_ms: 100, fade_ms: 200, opacity: 0.8, rotation_deg: 30 });
  const p = decalPlan(t, t.layers[0], 1);
  assert.equal(p.start_ms, 200);
  assert.equal(p.hold_until_ms, 800);
  assert.equal(p.end_ms, 1000);
  assert.equal(decalState(p, 100).opacity, 0);
  assert.ok(Math.abs(decalState(p, 250).opacity - 0.4) < 1e-9);
  assert.equal(decalState(p, 600).opacity, 0.8);
  assert.ok(Math.abs(decalState(p, 900).opacity - 0.4) < 1e-9);
  assert.equal(decalState(p, 1001).opacity, 0);
  assert.equal(decalState(p, 600).rotation_deg, 30);
});

test("lifetime_ms can keep a mark past the spell; grow and spin are applied", () => {
  const t = tpl({ shape: "rune_circle", lifetime_ms: 2000, grow_ms: 100, start_scale: 0.5, spin_deg_per_s: 90, rotation_deg: 0 });
  const p = decalPlan(t, t.layers[0], 1);
  assert.equal(p.hold_until_ms, 2200);
  assert.equal(decalState(p, 200).scale, 0.5);
  assert.equal(decalState(p, 300).scale, 1);
  assert.equal(decalState(p, 1200).rotation_deg, 90);
});

test("without a rotation each seed picks its own angle, the same every time", () => {
  const t = tpl({ shape: "cracks" });
  const a = decalPlan(t, t.layers[0], 1).rotation_deg;
  assert.equal(decalPlan(t, t.layers[0], 1).rotation_deg, a);
  assert.notEqual(decalPlan(t, t.layers[0], 2).rotation_deg, a);
  assert.ok(a >= 0 && a < 360);
});

test("pulse makes a warning ring throb", () => {
  const t = tpl({ shape: "warning_ring", pulse_hz: 5, fade_in_ms: 0 });
  const p = decalPlan(t, t.layers[0], 1);
  assert.ok(decalState(p, 300).opacity < decalState(p, 400).opacity);
});

test("the export manifest lists decals with textures, timing and per-frame curves", () => {
  const t = { ...tpl({ shape: "puddle", radius_px: 50, lifetime_ms: 1500 }, { color: "primary" }), id: "x", palette: { core: "#ffffff", primary: "#3366ff" } };
  const plan = framePlan(t, { fps: 10 });
  const d = buildDecals(t, 1, plan);
  assert.equal(d.length, 1);
  assert.equal(d[0].texture, "decal-mark.png");
  assert.equal(d[0].color, "#3366FF");
  assert.equal(d[0].size_units, 1.1);
  assert.equal(d[0].outlives_spell, true);
  assert.equal(d[0].curves.opacity.length, plan.count);
  assert.equal(d[0].curves.opacity[0], 0);
  assert.equal(d[0].curves.opacity[5], 0.85);
});

test("every decal in the library is in its manifest and guide", () => {
  const dir = new URL("../templates/", import.meta.url);
  for (const el of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const f of readdirSync(new URL(`${el.name}/`, dir))) {
      const t = load(`../templates/${el.name}/${f}`);
      const decals = t.layers.filter((l) => l.type === "decal");
      if (!decals.length) continue;
      const plan = framePlan(t);
      const sheets = [{ id: "all", first: 0, count: plan.count, layout: { width: 1, height: 1, columns: 1, rows: 1, blocks: 1 } }];
      const m = buildManifest({ template: t, seed: 1, plan, sheets, visible: {}, views: { top: {} }, tracks: buildTracks(t, 1, plan), frame: 64 });
      assert.equal(m.decals.length, decals.length, t.id);
      const guide = guideMarkdown(m, { files: [] });
      assert.match(guide, /## Decals/);
      for (const d of decals) assert.ok(guide.includes(`decal-${d.id}.png`), `${t.id}: ${d.id}`);
    }
  }
});
