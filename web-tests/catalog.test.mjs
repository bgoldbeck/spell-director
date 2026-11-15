import assert from "node:assert/strict";
import test from "node:test";
import { ALL, groupByType, resolveStart, spellsFor, step, typeLabel } from "../web/js/catalog.js";

const T = [
  { id: "lightning-sky-strike", name: "Sky Strike", element: "lightning" },
  { id: "fire-ember-burst", name: "Ember Burst", element: "fire" },
  { id: "lightning-chain-arc", name: "Chain Arc", element: "lightning" },
  { id: "mystery", name: "Mystery" },
];

test("groupByType groups by element, sorts types and spells, and keeps strays in other", () => {
  const g = groupByType(T);
  assert.deepEqual(g.map((x) => x.type), ["fire", "lightning", "other"]);
  assert.deepEqual(g[1].templates.map((t) => t.name), ["Chain Arc", "Sky Strike"]);
  assert.equal(g[1].label, "Lightning");
  assert.equal(typeLabel(ALL), "All types");
});

test("spellsFor lists one type, or every spell in group order for all", () => {
  const g = groupByType(T);
  assert.deepEqual(spellsFor(g, "fire").map((t) => t.id), ["fire-ember-burst"]);
  assert.deepEqual(spellsFor(g, ALL).map((t) => t.name), ["Ember Burst", "Chain Arc", "Sky Strike", "Mystery"]);
  assert.deepEqual(spellsFor(g, "ice"), []);
});

test("step wraps within the chosen type", () => {
  const g = groupByType(T);
  assert.equal(step(g, "lightning", "lightning-sky-strike", 1).id, "lightning-chain-arc");
  assert.equal(step(g, "lightning", "lightning-chain-arc", -1).id, "lightning-sky-strike");
  assert.equal(step(g, ALL, "mystery", 1).id, "fire-ember-burst");
  assert.equal(step(g, "fire", "lightning-sky-strike", 1).id, "fire-ember-burst");
  assert.equal(step(g, "ice", "x", 1), null);
});

test("resolveStart honors template and type, and reports unknown ids instead of hiding them", () => {
  const g = groupByType(T);
  assert.deepEqual(resolveStart(g, {}), { template: g[0].templates[0], type: ALL, error: null });
  const hit = resolveStart(g, { template: "lightning-sky-strike" });
  assert.equal(hit.template.id, "lightning-sky-strike");
  assert.equal(hit.error, null);
  assert.equal(resolveStart(g, { type: "lightning" }).template.id, "lightning-chain-arc");
  assert.equal(resolveStart(g, { type: "fire", template: "lightning-sky-strike" }).type, "lightning");
  const miss = resolveStart(g, { template: "nope" });
  assert.equal(miss.template.id, "fire-ember-burst");
  assert.match(miss.error, /No template with id "nope"/);
  const badType = resolveStart(g, { type: "ice" });
  assert.equal(badType.type, ALL);
  assert.match(badType.error, /No spells of type "ice"/);
});
