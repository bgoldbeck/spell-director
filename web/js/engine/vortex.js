// Vortex: a spinning funnel of air (tornado, whirlwind, dust devil, water
// spout). This module is the pure part, shared by the viewer and the Node
// tests: the funnel's shape, where it stands, how far it has spun, at any
// time t. No DOM or Three.js here; positions are plain {x, y, z} in world
// units (1 = a character's height), y up, the caster at the origin facing +x.

import { ease, layerWindow, paramAtFrom, resolveParams, rng, seedFor } from "./timeline.js";

const PX = 0.01; // template pixels -> world units (same as stage.js)
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const VORTEX_DEFAULTS = {
  height_px: 260, // how tall the funnel stands
  base_radius_px: 16, // radius where it touches the ground
  top_radius_px: 90, // radius at the top
  flare: 1.8, // how the radius opens with height: 1 = a straight cone, higher = a trumpet
  spin_hz: 1.5, // turns per second of the wall
  strands: 8, // wind streaks wrapping the funnel
  twist: 1.2, // turns a streak makes from the ground to the top
  turbulence: 0.5, // 0-1, how ragged and streaky the wall is
  sway_px: 22, // how far the middle of the funnel snakes off its axis
  sway_hz: 0.45,
  grow_ms: 450, // time to rise to full height from the start of its first beat
  opacity: 0.75,
  start_offset_px: 0, // forms this far short of its anchor (toward the caster)...
  meander_px: 0, // ...and weaves this far sideways while it walks to it during its travel beat
  wander_px: 8, // drift of the base while it holds in place
};

// Resolve a vortex layer once per cast. anchor: {x, z} where it ends up;
// castDir: unit {x, z} from the caster toward the anchor.
export function vortexPlan(template, layer, seed, anchor, castDir = { x: 1, z: 0 }, instance = 0) {
  const window = layerWindow(template, layer) || { start: 0, end: template.timing?.duration_ms ?? 1000, beats: [] };
  const base = { ...VORTEX_DEFAULTS, ...resolveParams(layer.params, seed, `${layer.id}#${instance}`) };
  const r = rng(seedFor(seed, layer.id, instance, "vortex"));
  const plan = {
    id: layer.id,
    window,
    base,
    keyframes: layer.keyframes || [],
    anchor: { x: anchor.x, z: anchor.z },
    dir: { x: castDir.x, z: castDir.z },
    travel: window.beats.find((b) => b.phase === "travel") || null,
    // When it lets go of what it carries: the start of its dissipation beat,
    // or the end of its last beat.
    release: window.beats.find((b) => b.phase === "dissipation")?.start_ms ?? window.end,
    swayPhase: [r.range(0, TAU), r.range(0, TAU)],
    wanderPhase: r.range(0, TAU),
    phaseTable: null,
  };
  plan.phaseTable = buildPhaseTable(plan);
  return plan;
}

export function vortexParam(plan, name, t) {
  const v = paramAtFrom(plan.base, plan.keyframes, name, t, plan.window.start);
  return v === undefined || v === null ? VORTEX_DEFAULTS[name] : v;
}

// How many turns the wall has made since its first beat began. spin_hz can
// be keyframed (spinning up, winding down), so the turns are integrated in
// 10 ms steps once per cast and looked up after that.
const STEP = 10;
function buildPhaseTable(plan) {
  const { start, end } = plan.window;
  const n = Math.max(1, Math.ceil((end - start) / STEP)) + 1;
  const table = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const t = start + (i - 0.5) * STEP;
    table[i] = table[i - 1] + (vortexParam(plan, "spin_hz", t) * STEP) / 1000;
  }
  return table;
}

export function spinTurns(plan, t) {
  const tab = plan.phaseTable;
  const x = (t - plan.window.start) / STEP;
  if (x <= 0) return (x * STEP * vortexParam(plan, "spin_hz", plan.window.start)) / 1000;
  const i = Math.floor(x);
  if (i >= tab.length - 1) {
    const last = tab[tab.length - 1];
    return last + ((x - (tab.length - 1)) * STEP * vortexParam(plan, "spin_hz", plan.window.end)) / 1000;
  }
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}

// 0 -> 1 as the funnel rises from the ground (ease out: fast, then settling).
export function growAt(plan, t) {
  const g = vortexParam(plan, "grow_ms", t);
  if (g <= 0) return t >= plan.window.start ? 1 : 0;
  return ease.ease_out(clamp01((t - plan.window.start) / g));
}

// Where the funnel touches the ground at time t.
export function baseAt(plan, t) {
  const { anchor, dir } = plan;
  const across = { x: -dir.z, z: dir.x };
  const off = vortexParam(plan, "start_offset_px", t) * PX;
  let along = 0; // distance back from the anchor
  let side = 0;
  if (off > 0) {
    const tb = plan.travel;
    let u = 1;
    if (tb) u = clamp01((t - tb.start_ms) / Math.max(1, tb.end_ms - tb.start_ms));
    else u = t >= plan.window.start ? 1 : 0;
    along = off * (1 - ease.ease_in_out(u));
    side = vortexParam(plan, "meander_px", t) * PX * Math.sin(u * TAU);
  }
  // A slow wander while it grinds in place.
  const w = vortexParam(plan, "wander_px", t) * PX;
  const s = t / 1000;
  const wx = w * Math.sin(s * 1.7 + plan.wanderPhase);
  const wz = w * Math.cos(s * 1.3 + plan.wanderPhase * 1.7);
  return {
    x: anchor.x - dir.x * along + across.x * side + wx,
    y: 0,
    z: anchor.z - dir.z * along + across.z * side + wz,
  };
}

// The funnel at time t: everything needed to place a point on its wall.
export function shapeAt(plan, t) {
  const g = growAt(plan, t);
  const grow = 0.45 + 0.55 * g;
  return {
    t,
    base: baseAt(plan, t),
    height: vortexParam(plan, "height_px", t) * PX * g,
    baseR: vortexParam(plan, "base_radius_px", t) * PX * grow,
    topR: vortexParam(plan, "top_radius_px", t) * PX * grow,
    flare: Math.max(0.3, vortexParam(plan, "flare", t)),
    sway: vortexParam(plan, "sway_px", t) * PX * g,
    swayAt: (t / 1000) * vortexParam(plan, "sway_hz", t) * TAU,
    swayPhase: plan.swayPhase,
    turns: spinTurns(plan, t),
    grow: g,
  };
}

// Radius of the wall at height fraction h (0 ground, 1 top).
export function radiusAt(shape, h) {
  const k = Math.pow(clamp01(h), shape.flare);
  return shape.baseR + (shape.topR - shape.baseR) * k;
}

// The funnel's axis at height fraction h: it snakes, pinned at the ground.
export function centerAt(shape, h) {
  const a = shape.swayAt;
  const [p0, p1] = shape.swayPhase;
  const bend = Math.sin(Math.PI * 0.5 * clamp01(h));
  return {
    x: shape.base.x + shape.sway * bend * Math.sin(a + p0 + h * 2.2),
    y: shape.height * h,
    z: shape.base.z + shape.sway * 0.8 * bend * Math.cos(a * 0.83 + p1 + h * 1.7),
  };
}

// A point on (or off, radial > 1) the wall at height fraction h and angle
// `turn` (in turns, 0-1 around).
export function wallPoint(shape, h, turn, radial = 1) {
  const c = centerAt(shape, h);
  const r = radiusAt(shape, h) * radial;
  return { x: c.x + Math.cos(turn * TAU) * r, y: c.y, z: c.z + Math.sin(turn * TAU) * r };
}
