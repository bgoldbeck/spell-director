import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { isSplash, splashLayout } from "../web/js/engine/splash.js";

const load = (p) => JSON.parse(readFileSync(new URL(`../templates/${p}`, import.meta.url), "utf8"));
const hammers = load("lightning/stormhammer-barrage.json");
const discs = load("lightning/ricochet-stormdiscs.json");
const cairn = load("lightning/runefall-cairn.json");
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test("a splash puts the primary target on the cast axis and the rest round it within the radius", () => {
  for (const seed of [1, 7, 42, 9001]) {
    const { primary, others } = splashLayout(hammers.space, seed);
    assert.equal(primary.z, 0);
    assert.ok(primary.x > 3, `primary at ${primary.x}`);
    assert.ok(others.length >= 5 && others.length <= 6, `${others.length} splash targets`);
    for (const p of others) {
      const d = dist(p, primary);
      assert.ok(d >= 0.55 * 1.9 - 1e-6 && d <= 2.2 + 1e-6, `splash target ${d} from the primary`);
    }
    // Spread round it, not bunched: no two enemies on top of each other.
    for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) assert.ok(dist(others[i], others[j]) > 0.35);
  }
});

test("the same seed gives the same layout; a new seed moves the enemies", () => {
  assert.deepEqual(splashLayout(hammers.space, 5), splashLayout(hammers.space, 5));
  assert.notDeepEqual(splashLayout(hammers.space, 5).others, splashLayout(hammers.space, 6).others);
});

test("ripple delays grow with distance from the primary target", () => {
  const { primary, others, delays } = splashLayout(hammers.space, 3);
  const ripple = hammers.space.targets.ripple_ms;
  others.forEach((p, k) => assert.ok(Math.abs(delays[k] - dist(p, primary) * ripple) < 1e-9));
});

test("ripple_ms 0 lands every splash target at once", () => {
  assert.ok(splashLayout(cairn.space, 11).delays.every((d) => d === 0));
});

test("sequence order hits the splash targets one after another (a ricochet)", () => {
  const { delays } = splashLayout(discs.space, 2);
  for (let k = 1; k < delays.length; k++) assert.ok(delays[k] > delays[k - 1]);
  assert.ok(delays[0] >= 110 && delays[0] <= 130);
});

test("only templates that ask for a splash layout get one", () => {
  assert.ok(isSplash(hammers.space));
  assert.ok(!isSplash(load("lightning/chain-arc.json").space));
});

test("every splash template has splash layers, and only splash templates do", () => {
  for (const dir of readdirSync(new URL("../templates/", import.meta.url), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(new URL(`../templates/${dir.name}/`, import.meta.url))) {
      const tpl = load(`${dir.name}/${f}`);
      const hasSplashLayers = tpl.layers.some((l) => l.anchor === "splash");
      assert.equal(hasSplashLayers, isSplash(tpl.space), tpl.id);
    }
  }
});

test("a point-blank splash (destination caster) puts every enemy round the caster", () => {
  const space = { origin: "caster", destination: "caster", travel: "instant", footprint: { shape: "circle", radius: 3 },
    targets: { layout: "splash", count: 8, radius: 3, ripple_ms: 100 } };
  const { primary, others, delays, centered } = splashLayout(space, 4);
  assert.ok(centered);
  assert.deepEqual(primary, { x: 0, z: 0 });
  assert.equal(others.length, 8);
  others.forEach((p, k) => {
    const d = Math.hypot(p.x, p.z);
    assert.ok(d >= 0.55 * 3 - 1e-6 && d <= 3 + 1e-6);
    assert.ok(Math.abs(delays[k] - d * 100) < 1e-9);
  });
});
