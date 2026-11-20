// Splash layout: one primary target the caster picks, and more enemies
// standing round it (space.targets.layout "splash"). Pure math on {x, z}
// ground points (world units, caster at the origin facing +X), so Node can
// test it and stage.js turns it into the 3D stage.

import { resolveValue, rng, seedFor } from "./timeline.js";

export const isSplash = (space) => space?.targets?.layout === "splash";

/**
 * {primary, others, delays}: the primary target on the cast axis at the
 * footprint length (capped at 6 units), the other enemies evenly round it
 * with jitter at 55-100% of targets.radius, and how many ms after the
 * primary each one's splash layers start.
 */
export function splashLayout(space, seed) {
  const t = space?.targets || {};
  const fp = space?.footprint || {};
  const length = resolveValue(fp.length, seed, "footprint.length") ?? 4;
  const count = Math.max(2, Math.round(resolveValue(t.count, seed, "targets.count") ?? 6));
  const R = resolveValue(t.radius, seed, "targets.radius") ?? resolveValue(fp.radius, seed, "footprint.radius") ?? 2;
  const r = rng(seedFor(seed, "targets.splash"));
  const primary = { x: Math.min(length, 6), z: 0 };
  const n = count - 1;
  const spin = r.range(0, Math.PI * 2);
  const others = [];
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * Math.PI * 2 + r.range(-0.35, 0.35) * (Math.PI / n);
    const d = R * r.range(0.55, 1);
    others.push({ x: primary.x + Math.cos(a) * d, z: primary.z + Math.sin(a) * d });
  }
  // ripple (default): later by distance from the primary, ripple_ms per
  // unit. sequence: one hop_delay_ms after another going round the primary
  // (others are already in order round it), a ricochet.
  const sequence = t.order === "sequence";
  const ripple = resolveValue(t.ripple_ms, seed, "targets.ripple") ?? 120;
  const delays = others.map((p, k) => (sequence
    ? (k + 1) * (resolveValue(t.hop_delay_ms, seed, "hop", k) ?? 90)
    : Math.hypot(p.x - primary.x, p.z - primary.z) * ripple));
  return { primary, others, delays };
}
