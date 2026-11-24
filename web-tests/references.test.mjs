import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet, spriteLayers } from "../web/js/engine/spritesheet.js";
import { REFERENCE_RULES, rangeGuideFiles, readmeMarkdown, referenceChecklist, referenceChecklistLines } from "../web/js/engine/references.js";
import { HOW_TO_USE } from "../web/js/engine/shader.js";
import { portingMarkdown } from "../web/js/engine/renderinfo.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const boss = load("../templates/lightning/boss-storm-call.json");
const cues = load("../web/sounds/cues.json");
const VIEWS = ["front", "side", "top", "three_quarter"];

function manifest(tpl) {
  const plan = framePlan(tpl);
  const views = Object.fromEntries(VIEWS.map((v) => [v, { camera: "perspective", pivots: {}, px_per_unit: 50 }]));
  const sprites = spriteLayers(tpl);
  const visible = Object.fromEntries(sprites.map((l) => [l.id, { first: 0, last: 5 }]));
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count }, ...sprites.map((l) => ({ id: l.id, first: 0, count: 6 }))]
    .map((s) => ({ ...s, layout: layoutSheet(s.count, VIEWS.length, { frame: 64 }) }));
  return buildManifest({ template: tpl, seed: 1, plan, sheets, visible, views, tracks: buildTracks(tpl, 1, plan, cues), version: "9.9.9", frame: 64 });
}

test("the checklist covers every view, every sheet and the spell's own references", () => {
  const m = manifest(boss);
  m.render = { porting: "render/PORTING.md", layers: [{ id: "x", file: "render/x.md" }] };
  m.caster_rig = { glb: "a.caster.glb", timeline: "a.timeline.json", clip: "a.caster.clip.json" };
  m.sound_sheet = "a.sounds.json";
  m.sound_files = ["a.preview.wav"];
  const items = referenceChecklist(m);
  const ids = items.map((i) => i.id);
  for (const v of VIEWS) assert.ok(ids.includes(`view-${v}`), `view ${v}`);
  for (const id of ["sheet-all", "sheet-layers", "data", "beats", "layers", "range-guide", "render-notes", "caster-rig", "sound"]) {
    assert.ok(ids.includes(id), id);
  }
  const files = items.flatMap((i) => i.files);
  for (const sh of m.sheets) assert.ok(files.includes(sh.image), `sheet ${sh.image} listed`);
  assert.ok(files.includes(rangeGuideFiles(boss.id).png));
  assert.ok(files.includes("render/x.md") && files.includes("a.caster.glb") && files.includes("a.preview.wav"));
  for (const it of items) assert.ok(it.use && it.check && it.files.length, `${it.id} says what to use and how to check`);
});

test("items only appear when the export has them", () => {
  const m = manifest(boss);
  const ids = referenceChecklist(m).map((i) => i.id);
  for (const id of ["render-notes", "caster-rig", "sound", "six-way", "loop"]) assert.ok(!ids.includes(id), id);
});

test("the guide opens with the required checklist and a final check", () => {
  const m = manifest(boss);
  const md = guideMarkdown(m, { files: [] });
  const top = md.indexOf("## Use every reference (required)");
  assert.ok(top > 0 && top < md.indexOf("## How to use this export") && top < md.indexOf("## Build it one layer at a time"));
  assert.ok(md.includes("### Before you build: study each reference"));
  assert.ok(md.includes("### Before you call it done: check against each reference"));
  for (const rule of REFERENCE_RULES) assert.ok(md.includes(rule));
  const boxes = md.split("\n").filter((l) => l.startsWith("- [ ] "));
  assert.equal(boxes.length, 2 * referenceChecklist(m).length, "one study box and one check box per reference");
  for (const v of ["Front view", "Side view", "Top view", "3/4 view"]) assert.ok(md.includes(v), v);
  assert.ok(/all four views/i.test(md) && /not done until/i.test(md));
});

test("the manifest's checklist is the one the guide prints", () => {
  const m = manifest(boss);
  m.reference_checklist = referenceChecklist(m).slice(0, 2);
  const md = guideMarkdown(m, { files: [] });
  assert.equal(md.split("\n").filter((l) => l.startsWith("- [ ] ")).length, 4);
  assert.deepEqual(referenceChecklistLines(m, []).filter((l) => l.startsWith("- [ ] ")), []);
});

test("the short how-to and the porting notes point back to the checklist", () => {
  assert.ok(/every reference/i.test(HOW_TO_USE[0]));
  assert.ok(portingMarkdown({ templateId: "x" }).includes("Use every reference (required)"));
});

test("the README says start with the guide and use every reference", () => {
  const m = manifest(boss);
  const md = readmeMarkdown(m);
  assert.ok(md.includes(`${boss.id}.guide.md`) && md.includes("Use every reference (required)"));
  assert.ok(/front, side, top, 3\/4/.test(md) && /do not be lazy/.test(md));
  for (const it of referenceChecklist(m)) assert.ok(md.includes(it.ref), it.ref);
});

test("volumetric layers get their own item, checked in all four views", () => {
  const m = manifest(boss);
  const ids = referenceChecklist(m).map((i) => i.id);
  assert.ok(!ids.includes("volumetric") || m.layers.some((l) => l.shader?.volumetric));
  m.layers[0].shader = { ...(m.layers[0].shader || {}), volumetric: true };
  const it = referenceChecklist(m).find((i) => i.id === "volumetric");
  assert.ok(it && it.files.includes("Volumetric layers section of this guide"));
  assert.ok(it.check.includes(m.layers[0].id) && /front, side, top, 3\/4/.test(it.check));
});
