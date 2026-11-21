// Motifs: small modeled things that play a part in a spell's little story
// (a leaf over a head, a dew drop running down it, petals, a feather, a
// blossom that opens, faceted gems circling a character). This is the pure
// part, shared by the viewer and the Node tests: where each item is at any
// time. No DOM or Three.js here. The meshes and materials are in motif.js.

export const MOTIF_SHAPES = ["leaf", "petal", "feather", "droplet", "blossom", "gem", "banner"];
export const GEM_CUTS = ["brilliant", "emerald", "cabochon", "marquise", "prism", "heart", "cocoon"];

// Per-cut look: clarity (0 = milky like jade, 1 = water clear), fire
// (rainbow flashes from dispersion) and whether its facets are flat.
export const GEM_LOOKS = {
  brilliant: { clarity: 1, fire: 0.7, facets: true },
  emerald: { clarity: 0.85, fire: 0.25, facets: true },
  cabochon: { clarity: 0.3, fire: 0, facets: false },
  marquise: { clarity: 0.95, fire: 0.5, facets: true },
  prism: { clarity: 0.9, fire: 0.45, facets: true },
  heart: { clarity: 0.95, fire: 0.5, facets: true },
  // A tall rough-faceted egg of crystal, big enough to hold a character.
  cocoon: { clarity: 0.6, fire: 0.2, facets: true },
};

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Overshoots a little past 1 and settles: a pop into being.
function popIn(u) {
  if (u >= 1) return 1;
  const s = 1.7;
  const v = u - 1;
  return 1 + (s + 1) * v * v * v + s * v * v;
}

// Where motif item i of `count` sits at local time `local` (ms from the
// layer's start), relative to its anchor, in template pixels: x along the
// cast direction, y up, z to the left of it (the viewer turns +z into -Z).
// p holds the layer's params at this moment (numbers, defaults applied here).
// Also returns its turn (radians about its own vertical), its tilt and roll,
// and `appear` (0-1, how far it has popped into being).
export function motifPlacement(p, i, count, local) {
  const n = Math.max(1, count);
  const s = local / 1000;
  const radius = p.orbit_radius_px ?? 0;
  const orbitHz = p.orbit_hz ?? 0;
  const a = (TAU * i) / n + TAU * orbitHz * s + ((p.orbit_phase_deg ?? 0) * Math.PI) / 180;
  // The orbit: a circle round the anchor, tilted about the cast direction
  // (orbit_tilt_deg), and waved up and down round the ring (weave_px).
  let x = Math.cos(a) * radius;
  let z = Math.sin(a) * radius;
  let y = 0;
  const tilt = ((p.orbit_tilt_deg ?? 0) * Math.PI) / 180;
  if (tilt) {
    const zz = z;
    z = zz * Math.cos(tilt);
    y = zz * Math.sin(tilt);
  }
  const weave = p.weave_px ?? 0;
  // weave_px: the ring rises and dips twice per turn, so items weave up and
  // down as they go round (a wavy crown).
  if (weave) y += weave * Math.sin(a * 2);
  const bobHz = p.bob_hz ?? 0.8;
  const bob = (p.bob_px ?? 0) * Math.sin(TAU * bobHz * s + (TAU * i) / n);
  // sway: a falling leaf's flutter, swinging side to side like a pendulum.
  const swayHz = p.sway_hz ?? 0.9;
  const swayPh = TAU * swayHz * s + i * 1.7;
  const sway = (p.sway_px ?? 0) * Math.sin(swayPh);
  x += p.forward_px ?? 0;
  y += (p.height_px ?? 100) + bob - (p.sway_px ? Math.abs(Math.cos(swayPh)) * (p.sway_px ?? 0) * 0.25 : 0);
  z += (p.side_px ?? 0) + sway;
  // Stacked items (stack_px) rise one above the other: a column of petals.
  y += (p.stack_px ?? 0) * i;
  const stagger = p.stagger_ms ?? 0;
  const appearMs = p.appear_ms ?? 0;
  const since = local - i * stagger;
  const appear = since < 0 ? 0 : appearMs > 0 ? popIn(clamp01(since / appearMs)) : 1;
  // Spinning items start at different turns, so they don't all flash at once.
  const spin = p.spin_hz ? TAU * p.spin_hz * s + i * 0.9 : 0;
  // face "out": each item's face turns outward from the anchor (leaves of a
  // shell); face "orbit": it turns to face the way it is moving round.
  const face = p.face === "out" ? a + Math.PI / 2 : p.face === "orbit" ? a + Math.PI : 0;
  const yaw = ((p.yaw_deg ?? 0) * Math.PI) / 180 + face + spin;
  const pitch = ((p.tilt_deg ?? 0) * Math.PI) / 180;
  const roll = ((p.roll_deg ?? 0) * Math.PI) / 180 + (p.sway_px ? 0.6 * Math.cos(swayPh) : 0);
  return { x, y, z, yaw, pitch, roll, appear, angle: a };
}
