// Status effects: lingering afflictions on one target (archetype "status")
// that apply, loop while they last and expire. The pure parts: catalog,
// coat settings, glyph names and the shape of the templates.
// (tests/test_viewer_render.py checks the rendered loops are seamless.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ALL, groupCatalog, isAura, isStatusEffect, spellsFor } from "../web/js/catalog.js";
import { COAT_PATTERNS, GLYPHS, coatSettings, isStatus } from "../web/js/engine/status.js";
import { decalPlan, decalState } from "../web/js/engine/decal.js";
import { layerLoop, layerWindow, loopRange } from "../web/js/engine/timeline.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const index = load("../templates/index.json").templates.map((p) => load(`../templates/${p}`));
const statuses = index.filter(isStatusEffect);

test("status effects are their own kind, apart from auras", () => {
  assert.ok(statuses.length >= 20, "a full set of status effects");
  const groups = groupCatalog(index);
  const g = groups.find((x) => x.type === "kind:status");
  assert.ok(g && g.kind);
  assert.equal(g.label, "Status effects");
  assert.deepEqual(g.templates.map((t) => t.id).sort(), statuses.map((t) => t.id).sort());
  const auras = groups.find((x) => x.type === "kind:aura");
  assert.ok(!auras.templates.some(isStatus), "a status effect isn't listed as an aura");
  assert.ok(statuses.every((t) => !isAura(t)));
  assert.equal(spellsFor(groups, ALL).length, index.length, "All types lists each spell once");
});

test("the owner's list is covered", () => {
  const names = statuses.map((t) => t.id);
  for (const want of ["burning", "frozen", "chilled", "poisoned", "diseased", "bleeding", "haunted", "dazed", "bubbled", "sleepy"]) {
    assert.ok(names.some((id) => id.endsWith(`-status-${want}`)), `a ${want} status effect`);
  }
});

test("every status effect sits on its target and has apply, loop and expire", () => {
  for (const tpl of statuses) {
    const lr = loopRange(tpl);
    assert.ok(lr, `${tpl.id} has a loop range`);
    assert.ok(lr.start > 0 && lr.end < tpl.timing.duration_ms, `${tpl.id} has room to apply and expire`);
    assert.equal(tpl.space.origin, "target");
    assert.equal(tpl.space.destination, "target");
    for (const l of tpl.layers) if (l.anchor) assert.equal(l.anchor, "target", `${tpl.id}/${l.id} sits on the target`);
    const phases = tpl.beats.map((b) => b.phase);
    assert.ok(phases.includes("impact") && phases.includes("dissipation"), `${tpl.id} applies and expires`);
    assert.ok(tpl.layers.some((l) => l.type !== "sound_cue" && layerLoop(tpl, layerWindow(tpl, l))), `${tpl.id} has something that loops`);
    for (const v of ["front", "side", "top", "three_quarter"]) assert.ok(tpl.views.reads[v], `${tpl.id} reads from ${v}`);
  }
});

test("status decals turn whole steps and pulse whole cycles per loop", () => {
  for (const tpl of statuses) {
    const lr = loopRange(tpl);
    for (const l of tpl.layers.filter((x) => x.type === "decal")) {
      const plan = decalPlan(tpl, l, 7);
      if (plan.start_ms > lr.start || plan.hold_until_ms < lr.end) continue;
      const a = decalState(plan, lr.start);
      const b = decalState(plan, lr.end);
      const step = plan.symmetry ? 360 / plan.symmetry : 360;
      const turn = (((b.rotation_deg - a.rotation_deg) % step) + step) % step;
      assert.ok(turn < 1e-6 || Math.abs(turn - step) < 1e-6, `${tpl.id}/${l.id} turns a whole step per loop`);
      assert.ok(Math.abs(a.opacity - b.opacity) < 1e-9, `${tpl.id}/${l.id} pulses whole cycles`);
    }
  }
});

test("coats and glyphs use names the viewer knows", () => {
  for (const tpl of statuses) {
    for (const l of tpl.layers) {
      if (l.type === "coat") assert.ok(COAT_PATTERNS[l.params.pattern || "glow"], `${tpl.id}/${l.id} pattern`);
      if (l.type === "sparks" && l.params.look === "glyph") assert.ok(GLYPHS.includes(l.params.glyph), `${tpl.id}/${l.id} glyph`);
    }
  }
  assert.ok(statuses.some((t) => t.layers.some((l) => l.type === "coat")), "coats are used");
});

test("coat settings fill in defaults and clamp", () => {
  const read = (params) => (n, f) => (params[n] === undefined ? f : params[n]);
  const d = coatSettings(read({}));
  assert.equal(d.pattern, "glow");
  assert.equal(d.shape, "body");
  assert.ok(Math.abs(d.cover - 1.3) < 1e-9, "covers the whole body by default");
  assert.equal(coatSettings(read({ pattern: "nope" })).pattern, "glow");
  const ice = coatSettings(read({ pattern: "ice", shape: "crystal", opacity: 3, cover_from_px: 75, cover_px: 83 }));
  assert.equal(ice.inflate, 0, "a crystal block isn't inflated");
  assert.equal(ice.opacity, 1);
  assert.ok(Math.abs(ice.coverFrom - 0.75) < 1e-9 && Math.abs(ice.cover - 0.83) < 1e-9);
  assert.equal(coatSettings(read({ pattern: "flame" })).flowHz, 1, "flames move by default");
  assert.equal(coatSettings(read({ pattern: "stone" })).flowHz, 0, "stone holds still");
});
