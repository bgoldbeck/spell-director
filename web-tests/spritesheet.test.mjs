import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ALL_ID, buildManifest, buildTracks, cellRect, framePlan, frameAt, guideMarkdown, layerKind, layoutSheet,
  sheetFileName, spriteLayers, visibleRange,
} from "../web/js/engine/spritesheet.js";
import { crc32, makeZip } from "../web/js/zip.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const sky = load("../templates/lightning/sky-strike.json");
const boss = load("../templates/lightning/boss-storm-call.json");
const cues = load("../web/sounds/cues.json");

test("framePlan uses the template's fps and covers the duration", () => {
  const p = framePlan(sky);
  assert.equal(p.fps, 30);
  assert.equal(p.count, 33); // 1100 ms at 30 fps
  assert.equal(p.times[0], 0);
  assert.ok(p.times.at(-1) < sky.timing.duration_ms);
  assert.equal(framePlan(sky, { fps: 12 }).count, 14);
  assert.equal(frameAt(p, 400), 12);
});

test("layerKind keeps sound, shake, lights and screen flashes out of the sheets", () => {
  assert.equal(layerKind({ type: "sound_cue" }), "sound");
  assert.equal(layerKind({ type: "camera_shake" }), "camera_shake");
  assert.equal(layerKind({ type: "light" }), "light");
  assert.equal(layerKind({ type: "flash", params: { scope: "screen" } }), "screen_flash");
  assert.equal(layerKind({ type: "flash", params: { scope: "local" } }), "sprite");
  const ids = spriteLayers(sky).map((l) => l.id);
  assert.ok(ids.includes("main-bolt"));
  assert.ok(!ids.includes("sky-dim"));
  const zs = spriteLayers(sky).map((l) => l.z ?? 0);
  assert.deepEqual(zs, [...zs].sort((a, b) => a - b));
});

test("visibleRange finds the first and last true frame", () => {
  assert.deepEqual(visibleRange([false, true, false, true, false]), { first: 1, last: 3 });
  assert.equal(visibleRange([false, false]), null);
});

test("sheet layout: columns are frames, rows are views, wrapping in blocks of views", () => {
  const l = layoutSheet(10, 4, { frame: 100, maxWidth: 1000 });
  assert.deepEqual([l.columns, l.blocks, l.rows, l.width, l.height], [10, 1, 4, 1000, 400]);
  assert.deepEqual(cellRect(l, 2, 3), { x: 300, y: 200, w: 100, h: 100 });
  const w = layoutSheet(25, 4, { frame: 100, maxWidth: 1000 });
  assert.deepEqual([w.columns, w.blocks, w.rows], [10, 3, 12]);
  // Frame 12 of the side view (row 1) is in the second block.
  assert.deepEqual(cellRect(w, 1, 12), { x: 200, y: 500, w: 100, h: 100 });
  assert.equal(sheetFileName(ALL_ID), "all.png");
  assert.equal(sheetFileName("main-bolt"), "layer-main-bolt.png");
});

test("tracks: sound cues, screen flashes and shake carry per-frame timing", () => {
  const plan = framePlan(boss);
  const t = buildTracks(boss, 1, plan, cues);
  assert.ok(t.sounds.length > 0);
  for (const s of t.sounds) {
    assert.equal(s.frame, frameAt(plan, s.at_ms));
    assert.ok(typeof s.sfx_prompt === "string");
  }
  for (const f of t.screen_flashes) assert.equal(f.opacity.length, plan.count);
  assert.ok(t.camera_shake.length > 0);
  const shake = t.camera_shake[0];
  assert.equal(shake.amplitude_px.length, plan.count);
  assert.ok(Math.max(...shake.amplitude_px) > 0);
  assert.deepEqual(buildTracks(boss, 1, plan, cues), t, "tracks are a pure function of template + seed");
});

function fakeManifest(tpl) {
  const plan = framePlan(tpl);
  const views = { front: { pivots: { caster: [10, 20], target: [90, 150] }, px_per_unit: 40 }, top: { pivots: {}, px_per_unit: 30 } };
  const sprites = spriteLayers(tpl);
  const visible = Object.fromEntries(sprites.map((l, i) => [l.id, i === 0 ? null : { first: 2, last: 9 }]));
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count }, ...sprites.slice(1).map((l) => ({ id: l.id, first: 2, count: 8 }))]
    .map((s) => ({ ...s, layout: layoutSheet(s.count, 2, { frame: 128 }) }));
  return buildManifest({ template: tpl, seed: 3, plan, sheets, visible, views, tracks: buildTracks(tpl, 3, plan, cues), version: "9.9.9", frame: 128 });
}

test("manifest lists every sheet, layer timing and view row", () => {
  const m = fakeManifest(sky);
  assert.equal(m.format, "spelldirector.spritesheet/1");
  assert.deepEqual(m.view_rows, ["front", "top"]);
  assert.equal(m.views.top.row, 1);
  assert.equal(m.sheets[0].image, "all.png");
  assert.equal(m.sheets[0].frame_count, m.frame_count);
  const bolt = m.layers.find((l) => l.id === "main-bolt");
  assert.equal(bolt.image, "layer-main-bolt.png");
  assert.equal(bolt.first_frame, 2);
  assert.equal(bolt.start_ms, Math.round(2 * m.frame_ms * 10) / 10);
  assert.equal(bolt.blend, "add");
  assert.ok(m.layers[0].empty, "a layer never drawn is marked empty");
  assert.equal(m.beats.length, sky.beats.length);
  assert.ok(m.screen_flashes.some((f) => f.layer === "sky-dim" && f.mode === "multiply"));
});

test("guide documents layers, timings, views, sounds and engine steps", () => {
  const m = fakeManifest(boss);
  const md = guideMarkdown(m, { files: [{ name: "x.json", about: "data" }] });
  for (const s of ["## How the sheets are laid out", "## Timeline (beats)", "## Layers", "### Sound cues",
    "### Camera shake", "## Rebuild it in Unity", "## How to use this export", "Shader intent", "- Unity: ", "- Godot 4: ", "## Reading the sheets as an AI model", "tools/sheet_cells.py", "## Rebuild it in Godot 4", "all.png", "layer-main-bolt.png", "x.json"]) {
    assert.ok(md.includes(s), `guide mentions ${s}`);
  }
  for (const b of boss.beats) assert.ok(md.includes(`| ${b.id} |`), `beat ${b.id} in the table`);
});

test("zip: stored entries with correct CRCs", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const zip = makeZip([{ name: "a/b.txt", data: "hello" }, { name: "c.bin", data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  assert.equal(new TextDecoder().decode(zip.subarray(30 + 7, 30 + 7 + 5)), "hello");
});

test("shader intent: template values win, defaults fill in, and every drawn layer gets engine hints", async () => {
  const { shaderFor, engineRecipe, describeShader, DEFAULT_SHADER } = await import("../web/js/engine/shader.js");
  const bolt = sky.layers.find((l) => l.id === "main-bolt");
  const sh = shaderFor(bolt);
  assert.equal(sh.from_template, true);
  assert.equal(sh.material, "ionized");
  assert.equal(shaderFor({ type: "sound_cue" }), null);
  const guessed = shaderFor({ id: "x", type: "smoke" });
  assert.equal(guessed.from_template, false);
  assert.equal(guessed.material, DEFAULT_SHADER.smoke.material);
  const r = engineRecipe(bolt, sh, "add");
  assert.ok(r.unity.some((x) => x.includes("Additive")));
  assert.ok(r.godot.some((x) => x.includes("blend_add")));
  assert.ok(describeShader(sh).includes("ridged"));
  const m = fakeManifest(sky);
  assert.ok(m.how_to_use.includes("not the effect itself"));
  for (const l of m.layers) {
    assert.ok(l.shader, `${l.id} has shader intent`);
    assert.ok(l.engine_hints.unity.length && l.engine_hints.godot.length);
  }
});
