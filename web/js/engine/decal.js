// Decals: marks projected onto the ground (scorch, cracks, puddles, frost,
// rune circles, warning rings...). This module is the pure part, shared by
// the viewer, the sprite exporter and the Node tests: what each shape is,
// its default blend, and how a decal's opacity, scale and rotation change
// over time. No DOM or Three.js here.

import { layerWindow, resolveParams, rng, seedFor } from "./timeline.js";

// shape -> {blend, about}. `add` decals glow (light on the ground); `alpha`
// decals paint the ground (darken or tint it).
export const DECAL_SHAPES = {
  scorch: { blend: "alpha", about: "dark burnt blotch with soot rays" },
  burn: { blend: "add", about: "glowing hot patch with embers, cools down" },
  cracks: { blend: "alpha", about: "branching cracks from the centre (add blend: glowing cracks)" },
  crater: { blend: "alpha", about: "dark dent with a raised, lighter rim and debris" },
  puddle: { blend: "alpha", about: "lumpy wet patch with a bright rim" },
  splash: { blend: "alpha", about: "wet patch with droplets splattered outward" },
  frost: { blend: "alpha", about: "icy crystals spiking outward" },
  swirl: { blend: "alpha", about: "ground scoured into spiral grooves by a vortex" },
  slash: { blend: "alpha", about: "thin crescent cuts gouged across the ground" },
  swept: { blend: "alpha", about: "dust swept into streaks fanning out along the cast direction" },
  rune_circle: { blend: "add", about: "magic circle: rings, glyph marks and a star" },
  warning_ring: { blend: "add", about: "area telegraph: faint fill, bright rim, ticks" },
  fissures: { blend: "alpha", about: "long ground fissures splitting outward from the centre (pair with arc_deg for a frontal fan)" },
};

export const DECAL_DEFAULTS = {
  shape: "scorch",
  radius_px: 40,
  opacity: 0.85,
  fade_in_ms: 60,
  fade_ms: 400,
  grow_ms: 0,
  start_scale: 0.6,
  spin_deg_per_s: 0,
  stretch: 1,
  pulse_hz: 0,
  detail: 0.5,
  arc_deg: 360,
  reveal_ms: 0,
};

export function decalShape(layer) {
  const s = layer.params?.shape;
  return DECAL_SHAPES[s] ? s : DECAL_DEFAULTS.shape;
}

export function decalBlend(layer) {
  return layer.blend || DECAL_SHAPES[decalShape(layer)].blend;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (u) => 1 - (1 - u) * (1 - u);

/**
 * Resolved settings and timeline for one decal layer (instance k).
 * Times are template ms. hold_until_ms can be past the spell's end: the mark
 * stays on the ground after the spell (the engine keeps it; the viewer only
 * shows the spell's duration).
 */
export function decalPlan(template, layer, seed, instance = 0) {
  const base = resolveParams(layer.params, seed, `${layer.id}#${instance}`);
  const p = (k) => (base[k] === undefined || base[k] === null ? DECAL_DEFAULTS[k] : base[k]);
  const win = layerWindow(template, layer);
  const start = win?.start ?? 0;
  const lifetime = base.lifetime_ms ?? (win ? win.end - win.start : 0);
  const arc = Math.max(1, Math.min(360, p("arc_deg")));
  // Without a rotation, each cast lays the mark at a random angle; an arc
  // mark faces the cast direction.
  const rotation = base.rotation_deg ?? (arc < 360 ? 0 : rng(seedFor(seed, layer.id, instance, "rotation")).range(0, 360));
  return {
    shape: decalShape(layer),
    blend: decalBlend(layer),
    radius_px: p("radius_px"),
    opacity: clamp01(p("opacity")),
    start_ms: start,
    fade_in_ms: Math.max(0, p("fade_in_ms")),
    hold_until_ms: start + Math.max(0, lifetime),
    fade_out_ms: Math.max(0, p("fade_ms")),
    grow_ms: Math.max(0, p("grow_ms")),
    start_scale: p("start_scale"),
    rotation_deg: rotation,
    spin_deg_per_s: p("spin_deg_per_s"),
    stretch: p("stretch"),
    pulse_hz: Math.max(0, p("pulse_hz")),
    detail: clamp01(p("detail")),
    arc_deg: arc,
    reveal_ms: Math.max(0, p("reveal_ms")),
    // Depth and fill (engine/style.js decalLook gives their defaults per style).
    look: { fill: base.fill, fill_color: base.fill_color, fill_flow: base.fill_flow, fill_in_ms: base.fill_in_ms, depth: base.depth },
    end_ms: start + Math.max(0, lifetime) + Math.max(0, p("fade_ms")),
  };
}

// How much of a decal's fill has risen (0-1) and how hot it still is (1 =
// fresh, 0 = cooled to a crust): the fill rises over fill_in_ms from the
// decal's start and cools while the decal fades out.
export function decalFillState(plan, t, fillInMs = 200) {
  const d = t - plan.start_ms;
  if (d < 0) return { amount: 0, heat: 1 };
  const amount = fillInMs > 0 ? clamp01(d / fillInMs) : 1;
  const cool = t > plan.hold_until_ms && plan.fade_out_ms > 0 ? clamp01((t - plan.hold_until_ms) / plan.fade_out_ms) : t > plan.hold_until_ms ? 1 : 0;
  return { amount, heat: (1 - cool) * (1 - cool) };
}

// Opacity (0-1), scale (multiplier of the full size), rotation (degrees,
// counter-clockwise seen from above, 0 = along the cast direction) and reveal
// (0-1: how far out from the centre the mark has spread, for reveal_ms) at t.
export function decalState(plan, t) {
  const d = t - plan.start_ms;
  if (d < 0 || t > plan.end_ms) return { opacity: 0, scale: plan.grow_ms > 0 ? plan.start_scale : 1, rotation_deg: plan.rotation_deg, reveal: d < 0 && plan.reveal_ms > 0 ? 0 : 1 };
  let o = plan.fade_in_ms > 0 ? clamp01(d / plan.fade_in_ms) : 1;
  if (t > plan.hold_until_ms) o *= plan.fade_out_ms > 0 ? clamp01(1 - (t - plan.hold_until_ms) / plan.fade_out_ms) : 0;
  if (plan.pulse_hz > 0) o *= 0.7 + 0.3 * Math.cos((d / 1000) * plan.pulse_hz * Math.PI * 2);
  const scale = plan.grow_ms > 0 ? plan.start_scale + (1 - plan.start_scale) * easeOut(clamp01(d / plan.grow_ms)) : 1;
  return {
    opacity: o * plan.opacity,
    scale,
    rotation_deg: plan.rotation_deg + (plan.spin_deg_per_s * d) / 1000,
    reveal: plan.reveal_ms > 0 ? clamp01(d / plan.reveal_ms) : 1,
  };
}
