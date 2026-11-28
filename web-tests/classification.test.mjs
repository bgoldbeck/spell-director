// Spell classification: the template's stages, category, delivery, area and
// duration. These check the labels and engine notes (engine/classification.js),
// the classification groups in the Type list, and that exports carry it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AXES, STAGES, classificationGuideLines, classificationLabel, classificationOut, stagesLabel } from "../web/js/engine/classification.js";
import { ALL, CLASS_PREFIX, groupCatalog, spellsFor } from "../web/js/catalog.js";
import { ALL_ID, buildManifest, buildTracks, framePlan, guideMarkdown, layoutSheet, spriteLayers } from "../web/js/engine/spritesheet.js";
import { readmeMarkdown } from "../web/js/engine/references.js";

const root = new URL("../templates/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")).templates.map((p) => JSON.parse(readFileSync(new URL(p, root), "utf8")));
const schema = JSON.parse(readFileSync(new URL("../schemas/template-0.1.0.schema.json", import.meta.url), "utf8"));
const byId = (id) => index.find((t) => t.id === id);

test("the labels cover every value the schema allows", () => {
  const props = schema.properties.classification.properties;
  assert.deepEqual(props.stages.items.enum, STAGES);
  for (const { key, values } of AXES) assert.deepEqual(Object.keys(values), props[key].enum, `labels for ${key}`);
});

test("every spell is classified, and labels read in order", () => {
  for (const t of index) assert.ok(t.classification, `${t.id} has a classification`);
  const jet = byId("fire-flame-jet");
  assert.equal(stagesLabel(jet), "Cast > Travel > Impact");
  assert.equal(classificationLabel(jet), "Damage · Beam · Single target · Channeled");
  const snare = byId("nature-brambleheart-snare");
  assert.equal(classificationLabel(snare), "Damage (also control) · Projectile · Targeted AoE · Instant");
  assert.equal(stagesLabel(byId("poison-mire-splat")), "Cast > Travel > Impact > Linger");
  assert.equal(classificationLabel({ id: "x" }), "");
});

test("the Type list gets classification groups that All types skips", () => {
  const groups = groupCatalog(index);
  const cls = groups.filter((g) => g.axis);
  assert.deepEqual([...new Set(cls.map((g) => g.axis))], ["Stages", ...AXES.map((a) => a.label)]);
  for (const g of cls) assert.ok(g.type.startsWith(CLASS_PREFIX));
  const ids = (type) => spellsFor(groups, type).map((t) => t.id);
  assert.ok(ids("class:duration:lingering").includes("poison-mire-splat"), "ground lingering lists the splat");
  assert.ok(ids("class:category:buff").includes("nature-jade-serenity"));
  assert.ok(ids("class:category:debuff").includes("fire-status-burning"));
  assert.ok(ids("class:category:control").includes("nature-brambleheart-snare"), "also-categories list the spell too");
  assert.ok(ids("class:stages:cast-travel-impact").includes("fire-ember-volley"));
  const stagesTotal = cls.filter((g) => g.axis === "Stages").reduce((n, g) => n + g.templates.length, 0);
  assert.equal(stagesTotal, index.length, "each spell is in exactly one stage pattern");
  assert.equal(spellsFor(groups, ALL).length, index.length, "All types lists each spell once");
});

test("exports carry the classification and map stages onto game events", () => {
  const tpl = byId("poison-mire-splat");
  const out = classificationOut(tpl);
  assert.deepEqual(out.stages, ["cast", "travel", "impact", "linger"]);
  assert.match(out.summary, /Ground lingering/);
  const lines = classificationGuideLines(tpl).join("\n");
  for (const s of ["## What kind of spell this is", "Travel:", "Linger:", "Lingering:"]) assert.ok(lines.includes(s), `guide says ${s}`);

  const plan = framePlan(tpl);
  const sprites = spriteLayers(tpl);
  const visible = Object.fromEntries(sprites.map((l) => [l.id, { first: 0, last: plan.count - 1 }]));
  const sheets = [{ id: ALL_ID, first: 0, count: plan.count }].map((s) => ({ ...s, layout: layoutSheet(s.count, 4, { frame: 64 }) }));
  const views = { front: { pivots: {}, px_per_unit: 40 } };
  const m = buildManifest({ template: tpl, seed: 1, plan, sheets, visible, views, tracks: buildTracks(tpl, 1, plan, []), frame: 64 });
  assert.equal(m.template.classification.duration, "lingering");
  assert.ok(guideMarkdown(m).includes("## What kind of spell this is"));
  assert.ok(readmeMarkdown(m).includes("**What kind of spell**"));
});
