// Auras: templates with a timing.loop_range whose sustain section loops
// seamlessly. The pure parts: loop math, playback, catalog, export and
// sound sheet. (tests/test_viewer_render.py checks the rendered frames.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advancePlayhead, layerLoop, loopHz, loopPeriod, loopRange, loopTick } from "../web/js/engine/timeline.js";
import { decalPlan, decalState } from "../web/js/engine/decal.js";
import { groupCatalog, isAura, spellsFor, ALL } from "../web/js/catalog.js";
import { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet, loopFrames, spriteLayers } from "../web/js/engine/spritesheet.js";
import { soundSheet } from "../web/js/engine/sound.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const cues = load("../web/sounds/cues.json");
const index = load("../templates/index.json").templates.map((p) => load(`../templates/${p}`));
const auras = index.filter(isAura);
const aegis = load("../templates/light/consecrated-aegis.json");

test("loop range and which layers loop", () => {
  const lr = loopRange(aegis);
  assert.deepEqual(lr, { start: 1200, end: 4200, len: 3000 });
  assert.equal(loopRange({ timing: { duration_ms: 500 } }), null);
  assert.deepEqual(layerLoop(aegis, { start: 0, end: 5000 }), lr);
  assert.equal(layerLoop(aegis, { start: 450, end: 1150 }), null, "a start-up one-shot doesn't loop");
});

test("rates and periods snap to whole cycles per loop, ticks wrap", () => {
  const loop = { start: 1200, end: 4200, len: 3000 };
  assert.equal(loopHz(0, loop), 0);
  assert.equal(loopHz(1, loop), 1);
  assert.ok(Math.abs(loopHz(0.5, loop) - 2 / 3) < 1e-9, "1.5 cycles round to 2");
  assert.ok(Math.abs(loopHz(0.01, loop) - 1 / 3) < 1e-9, "never rounds a rate down to nothing");
  assert.equal(loopHz(-0.5, loop) < 0, true);
  assert.equal(loopHz(15, loop, 45), 15, "spin of 45 degrees per loop for an 8-fold circle");
  assert.equal(loopPeriod(700, loop), 750);
  assert.equal(loopHz(2.5, null), 2.5);
  for (const t of [1200, 1999, 2600, 3333]) assert.equal(loopTick(t, 0, 50, loop), loopTick(t + 3000, 0, 50, loop));
});

test("playback holds an aura's loop while looping is on and plays its end when off", () => {
  const lr = loopRange(aegis);
  const hold = advancePlayhead(4150, 4250, 5000, true, lr);
  assert.equal(hold.t, 1250);
  assert.deepEqual(hold.wrap, { end: 4200, start: 1200 });
  const end = advancePlayhead(4150, 4250, 5000, false, lr);
  assert.equal(end.t, 4250);
  assert.equal(end.wrap, null);
  assert.equal(advancePlayhead(4950, 5050, 5000, false, lr).ended, true);
  assert.equal(advancePlayhead(4950, 5050, 5000, true, null).t, 50, "a one-shot spell replays from 0");
});

test("every aura loops cleanly: spinning and pulsing decals are the same at both ends of the loop", () => {
  assert.ok(auras.length >= 6);
  for (const tpl of auras) {
    const lr = loopRange(tpl);
    for (const l of tpl.layers.filter((x) => x.type === "decal")) {
      const plan = decalPlan(tpl, l, 7);
      if (plan.start_ms > lr.start || plan.hold_until_ms < lr.end) continue;
      const a = decalState(plan, lr.start);
      const b = decalState(plan, lr.end);
      const turn = ((b.rotation_deg - a.rotation_deg) % (plan.symmetry ? 360 / plan.symmetry : 360) + 360) % (plan.symmetry ? 360 / plan.symmetry : 360);
      assert.ok(turn < 1e-6 || Math.abs(turn - (plan.symmetry ? 360 / plan.symmetry : 360)) < 1e-6, `${tpl.id}/${l.id} turns a whole step per loop`);
      assert.ok(Math.abs(a.opacity - b.opacity) < 1e-9, `${tpl.id}/${l.id} pulses whole cycles`);
    }
  }
});

test("auras are a kind that cuts across elements and lines", () => {
  const groups = groupCatalog(index);
  const g = groups.find((x) => x.type === "kind:aura");
  assert.ok(g && g.kind);
  assert.deepEqual(g.templates.map((t) => t.id).sort(), auras.map((t) => t.id).sort());
  assert.ok(new Set(g.templates.map((t) => t.element)).size >= 5, "auras in several elements");
  for (const line of ["Paladin", "Druid", "Bard", "Necromancer", "Sorcerer"]) {
    assert.ok(g.templates.some((t) => t.line === line), `an aura in the ${line} line`);
  }
  const all = spellsFor(groups, ALL);
  assert.equal(all.length, index.length, "All types lists each spell once");
});

test("exports mark the loop: frames, per-layer columns, guide section and sound sections", () => {
  const plan = framePlan(aegis);
  const lf = loopFrames(aegis, plan);
  assert.deepEqual([lf.first_frame, lf.end_frame, lf.frame_count, lf.frame_exact], [36, 126, 90, true]);
  const sprites = spriteLayers(aegis);
  const visible = Object.fromEntries(sprites.map((l) => [l.id, { first: 0, last: plan.count - 1 }]));
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count }, ...sprites.map((l) => ({ id: l.id, first: l.id === "halo-rings" ? 10 : 0, count: plan.count - 10 }))]
    .map((s) => ({ ...s, layout: layoutSheet(s.count, 4, { frame: 64 }) }));
  const views = { front: { pivots: {}, px_per_unit: 40 } };
  const m = buildManifest({ template: aegis, seed: 1, plan, sheets, visible, views, tracks: buildTracks(aegis, 1, plan, cues), frame: 64 });
  assert.equal(m.loop_range.first_frame, 36);
  assert.deepEqual(m.layers.find((l) => l.id === "halo-rings").loop_columns, { first: 26, end: 116 });
  assert.equal(m.layers.find((l) => l.id === "consecration-wave").loop_columns, null, "the start-up ring is a one-shot");
  const md = guideMarkdown(m);
  for (const s of ["## Aura loop", "Start-up", "36–125", "Animator", "AnimatedSprite2D", "in_loop"]) assert.ok(md.includes(s), `guide mentions ${s}`);
  const sheet = soundSheet(aegis, 1, cues);
  assert.deepEqual(sheet.spell.loop_range, { start_ms: 1200, end_ms: 4200 });
  const hum = sheet.events.find((e) => e.layer === "aura-hum");
  assert.equal(hum.section, "loop");
  assert.equal(hum.in_loop, true);
  assert.equal(sheet.events.find((e) => e.layer === "raise-sound").section, "intro");
  assert.equal(sheet.events.find((e) => e.layer === "lift-sound").section, "outro");
  const chimes = sheet.events.filter((e) => e.layer === "halo-chime").map((e) => e.at_ms);
  assert.deepEqual(chimes, [1500, 3000], "chimes repeat on the loop's rhythm");
});
