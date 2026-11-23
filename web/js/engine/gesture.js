// Arms, hands and fingers on the stand-in figures, and the casting gestures
// that move them: raise, throw, push palm-out, point a finger, slam, roar...
// Pure math (no Three.js), so Node can test it, the stage can put an anchor
// on a hand or a fingertip, and the studio can draw the arms from the same
// numbers. The viewer stays a pure function of time: the arms' pose depends
// only on the gesture list and the time.
//
// Frame: a figure one unit tall standing at the origin facing +X, up +Y.
// The caster's lead hand (the casting hand, where `caster_hand` is) is on
// its -Z side; the off hand is on +Z. Poses are written in "outward"
// coordinates, where +z is away from the body on that arm's side, so one
// pose fits either arm and two-handed gestures come out mirrored.

export const GESTURE_KINDS = [
  "rest",
  "raise",
  "point",
  "push",
  "throw",
  "spin_throw",
  "sky_point",
  "sign",
  "channel",
  "hold_orb",
  "raise_both",
  "push_both",
  "channel_both",
  "gather",
  "summon",
  "slam",
  "clap",
  "roar",
  "flex",
  "ground_press",
  "guard",
  "flail",
  "cheer",
  "slash",
  "backslash",
  "chop",
  "rising_slash",
  "thrust",
  "blade_out",
  "cleave",
  "sweep_both",
];

export const HANDS = ["lead", "off", "both"];

// Anchors on the caster's hands: they follow the arms. caster_hand is the
// lead (casting) hand's palm; caster_fingertip its index fingertip;
// caster_hands the point between both palms.
// caster_blade and caster_blade_tip are the middle and the point of the
// caster's held blade (space.caster_weapon; without one, where a sword would be).
export const HAND_ANCHORS = ["caster_hand", "caster_off_hand", "caster_fingertip", "caster_off_fingertip", "caster_hands", "caster_blade", "caster_blade_tip"];
export const isHandAnchor = (name) => HAND_ANCHORS.includes(name);

// Finger curl (0 straight, 1 fully curled) for thumb, index, middle, ring,
// pinky, and how far the fingers fan apart (0-1).
export const HAND_SHAPES = {
  relaxed: { curl: [0.25, 0.3, 0.35, 0.4, 0.45], spread: 0.15 },
  open: { curl: [0.1, 0.08, 0.1, 0.14, 0.18], spread: 0.35 },
  flat: { curl: [0.15, 0, 0, 0, 0], spread: 0.05 },
  spread: { curl: [0, 0, 0, 0, 0.02], spread: 1 },
  claw: { curl: [0.3, 0.33, 0.36, 0.36, 0.38], spread: 0.9 },
  cup: { curl: [0.3, 0.35, 0.35, 0.35, 0.4], spread: 0.25 },
  grip: { curl: [0.55, 0.6, 0.65, 0.7, 0.7], spread: 0.15 },
  fist: { curl: [0.75, 1, 1, 1, 1], spread: 0 },
  point: { curl: [0.6, 0, 1, 1, 1], spread: 0 },
  sign: { curl: [0.65, 0, 0, 1, 1], spread: 0.45 },
};

// Body measurements (world units; the figure is one unit tall).
export const BODY = {
  shoulder: [0, 0.66, 0.2], // outward coords
  upper: 0.21,
  fore: 0.2,
  palmLen: 0.085,
  palmWidth: 0.075,
  palmThick: 0.03,
  fingers: [0.056, 0.062, 0.07, 0.063, 0.05], // thumb..pinky
};

// Named poses, outward coords. w: the wrist; aim: the way the fingers point;
// palm: the way the palm faces; shape: a HAND_SHAPES name.
const POSES = {
  ready: { w: [0.235, 0.68, 0.22], aim: [1, 0, 0], palm: [0, -0.3, -1], shape: "open" },
  hang: { w: [0.04, 0.27, 0.25], aim: [0, -1, 0.05], palm: [0, 0, -1], shape: "relaxed" },
  raised: { w: [0.06, 1.06, 0.24], aim: [0, 1, 0], palm: [1, 0, -0.2], shape: "spread" },
  fist_high: { w: [0.06, 1.06, 0.24], aim: [0, 1, 0], palm: [1, 0, -0.2], shape: "fist" },
  push_back: { w: [0.06, 0.72, 0.22], aim: [0, 1, 0], palm: [1, 0, 0], shape: "flat" },
  push_out: { w: [0.36, 0.72, 0.14], aim: [0, 1, 0], palm: [1, 0, 0], shape: "flat" },
  point: { w: [0.37, 0.74, 0.12], aim: [1, 0.05, -0.12], palm: [0, -0.4, -1], shape: "point" },
  aim_back: { w: [-0.2, 0.95, 0.27], aim: [0.2, 1, 0], palm: [1, 0.3, -0.3], shape: "grip" },
  throw_release: { w: [0.33, 0.62, 0.04], aim: [1, -0.35, -0.25], palm: [0, -1, 0.2], shape: "spread" },
  aim_fwd: { w: [0.3, 0.8, 0.12], aim: [1, 0.2, -0.1], palm: [0, -0.3, -1], shape: "open" },
  tuck: { w: [0.02, 0.6, 0.27], aim: [0.4, -0.6, 0], palm: [0, 0, -1], shape: "fist" },
  whip_back: { w: [-0.18, 0.7, 0.33], aim: [-0.6, 0, 0.8], palm: [0, -1, 0], shape: "grip" },
  whip_release: { w: [0.34, 0.7, -0.04], aim: [0.9, 0, -0.45], palm: [0, -1, 0], shape: "spread" },
  counter_fwd: { w: [0.26, 0.66, 0.08], aim: [1, 0, -0.4], palm: [0, -1, 0], shape: "open" },
  counter_back: { w: [-0.12, 0.62, 0.3], aim: [-0.7, -0.2, 0.6], palm: [0, -1, 0], shape: "open" },
  gather: { w: [0.2, 0.6, 0.08], aim: [0.8, 0.6, 0], palm: [0, 0, -1], shape: "cup" },
  low_up: { w: [0.16, 0.4, 0.27], aim: [1, 0, 0.2], palm: [0, 1, 0], shape: "open" },
  fists_high: { w: [0.03, 1.1, 0.12], aim: [0, 1, -0.2], palm: [1, 0, 0], shape: "fist" },
  slam_low: { w: [0.28, 0.22, 0.12], aim: [0.3, -1, 0], palm: [0, 0, -1], shape: "fist" },
  flex: { w: [0.1, 0.86, 0.3], aim: [0, 1, 0], palm: [-1, 0, 0], shape: "fist" },
  wide: { w: [0.06, 0.78, 0.48], aim: [0, 0.5, 1], palm: [1, 0, 0], shape: "claw" },
  guard: { w: [0.2, 0.88, 0.07], aim: [0, 1, 0], palm: [-1, 0, 0], shape: "flat" },
  sign: { w: [0.17, 0.84, 0.08], aim: [0, 1, 0], palm: [1, 0, 0], shape: "sign" },
  sky_point: { w: [0.12, 1.06, 0.14], aim: [0.25, 1, -0.05], palm: [1, 0, -0.3], shape: "point" },
  ground: { w: [0.3, 0.32, 0.16], aim: [1, -0.2, 0], palm: [0, -1, 0], shape: "spread" },
  clap_open: { w: [0.25, 0.74, 0.32], aim: [0.4, 1, 0], palm: [0, 0, -1], shape: "flat" },
  clap: { w: [0.3, 0.74, 0.025], aim: [0.3, 1, 0], palm: [0, 0, -1], shape: "flat" },
  channel: { w: [0.36, 0.7, 0.1], aim: [1, 0.1, 0], palm: [0.6, -0.8, 0], shape: "claw" },
  orb_hold: { w: [0.25, 0.68, 0.2], aim: [1, 0, 0], palm: [0, 1, 0], shape: "cup" },
  flail: { w: [0.25, 0.95, 0.32], aim: [0.5, 1, 0.3], palm: [1, 0, 0], shape: "spread" },
  // Sword poses: a fist round the grip, and `blade`, the way the blade points.
  blade_ready: { w: [0.2, 0.52, 0.22], aim: [1, -0.5, 0], palm: [0, 0, -1], blade: [0.7, 0.7, -0.12], shape: "fist" },
  slash_wind: { w: [0.0, 0.8, 0.4], aim: [0.2, 0.2, 1], palm: [0, -1, 0], blade: [-0.55, 0.15, 0.82], shape: "fist" },
  slash_mid: { w: [0.37, 0.72, 0.08], aim: [1, 0, 0.2], palm: [0, -1, 0], blade: [1, 0.04, 0], shape: "fist" },
  slash_end: { w: [0.26, 0.68, -0.08], aim: [0.5, 0, -1], palm: [0, -1, 0], blade: [0.12, -0.04, -1], shape: "fist" },
  back_end: { w: [0.12, 0.74, 0.4], aim: [0.4, 0, 1], palm: [0, 1, 0], blade: [-0.25, 0.08, 1], shape: "fist" },
  chop_high: { w: [0.0, 1.02, 0.18], aim: [0, 1, 0.1], palm: [1, 0, 0], blade: [-0.4, 0.92, 0], shape: "fist" },
  chop_mid: { w: [0.3, 0.86, 0.12], aim: [1, 0.4, 0], palm: [0, -1, 0], blade: [1, 0.35, 0], shape: "fist" },
  chop_end: { w: [0.33, 0.42, 0.12], aim: [0.6, -0.8, 0], palm: [0, 0, -1], blade: [0.72, -0.68, 0], shape: "fist" },
  rise_low: { w: [0.16, 0.34, 0.28], aim: [0.3, -1, 0], palm: [0, 0, -1], blade: [0.42, -0.86, 0.12], shape: "fist" },
  rise_mid: { w: [0.36, 0.66, 0.13], aim: [1, 0, 0], palm: [0, 0, -1], blade: [1, 0.12, 0], shape: "fist" },
  rise_end: { w: [0.14, 1.0, 0.17], aim: [0.2, 1, 0], palm: [0, 0, -1], blade: [0.25, 1, -0.05], shape: "fist" },
  thrust_draw: { w: [-0.04, 0.58, 0.3], aim: [0, -0.3, -1], palm: [0, -1, 0], blade: [1, 0.06, -0.08], shape: "fist" },
  thrust_out: { w: [0.4, 0.68, 0.07], aim: [0, -0.3, -1], palm: [0, -1, 0], blade: [1, 0.02, -0.03], shape: "fist" },
  blade_out: { w: [0.24, 0.68, 0.31], aim: [0.6, 0, 0.8], palm: [0, -1, 0], blade: [0.55, 0.02, 0.84], shape: "fist" },
  cleave_high: { w: [-0.02, 1.0, 0.05], aim: [0, 1, 0], palm: [0, 0, -1], blade: [-0.45, 0.9, 0], shape: "fist" },
  cleave_end: { w: [0.36, 0.45, 0.05], aim: [0.6, -0.8, 0], palm: [0, 0, -1], blade: [0.8, -0.6, 0], shape: "fist" },
  sweep_both: { w: [0.33, 0.62, 0.06], aim: [1, 0, 0], palm: [0, 0, -1], blade: [0.35, 0, 0.94], shape: "fist" },
};

// Each gesture: a default length, and keys [u, pose, ease] where u is the
// fraction of duration_ms (the last key lands at at_ms + duration_ms: the
// release of a throw). `both`: a two-handed gesture (hand is ignored).
// `other`: what the other arm does during a one-handed gesture.
const GESTURES = {
  rest: { ms: 350, keys: [[1, "rest"]] },
  raise: { ms: 450, keys: [[1, "raised"]] },
  point: { ms: 300, keys: [[1, "point"]] },
  push: { ms: 450, keys: [[0.45, "push_back"], [1, "push_out", "in"]] },
  throw: { ms: 550, keys: [[0.6, "aim_back"], [1, "throw_release", "in"]], other: [[0.6, "aim_fwd"], [1, "tuck", "in"]] },
  spin_throw: { ms: 600, keys: [[0.6, "whip_back"], [1, "whip_release", "in"]], other: [[0.6, "counter_fwd"], [1, "counter_back", "in"]] },
  sky_point: { ms: 400, keys: [[1, "sky_point"]] },
  sign: { ms: 350, keys: [[1, "sign"]] },
  channel: { ms: 400, keys: [[1, "channel"]] },
  hold_orb: { ms: 350, keys: [[1, "orb_hold"]] },
  raise_both: { ms: 500, both: true, keys: [[1, "raised"]] },
  push_both: { ms: 450, both: true, keys: [[0.45, "push_back"], [1, "push_out", "in"]] },
  channel_both: { ms: 400, both: true, keys: [[1, "channel"]] },
  gather: { ms: 450, both: true, keys: [[1, "gather"]] },
  summon: { ms: 700, both: true, keys: [[0.35, "low_up"], [1, "raised"]] },
  slam: { ms: 600, both: true, keys: [[0.6, "fists_high"], [1, "slam_low", "in"]] },
  clap: { ms: 450, both: true, keys: [[0.55, "clap_open"], [1, "clap", "in"]] },
  roar: { ms: 700, both: true, keys: [[0.45, "flex"], [1, "wide", "out"]] },
  flex: { ms: 400, both: true, keys: [[1, "flex"]] },
  ground_press: { ms: 500, both: true, keys: [[1, "ground", "in"]] },
  guard: { ms: 250, both: true, keys: [[1, "guard"]] },
  flail: { ms: 300, both: true, keys: [[1, "flail", "out"]] },
  cheer: { ms: 350, both: true, keys: [[1, "fist_high"]] },
  // Sword strokes (with space.caster_weapon the blade rides in the lead
  // hand). The blade crosses the front of the caster at about 75% of a
  // slash; a chop, rising slash or thrust lands at its end.
  slash: { ms: 520, keys: [[0.45, "slash_wind"], [0.75, "slash_mid", "in"], [1, "slash_end", "out"]], other: [[0.45, "aim_fwd"], [1, "tuck", "in"]] },
  backslash: { ms: 480, keys: [[0.4, "slash_end"], [0.75, "slash_mid", "in"], [1, "back_end", "out"]], other: [[0.4, "tuck"], [1, "counter_back", "in"]] },
  chop: { ms: 520, keys: [[0.55, "chop_high"], [0.8, "chop_mid", "in"], [1, "chop_end", "out"]], other: [[0.55, "aim_fwd"], [1, "tuck", "in"]] },
  rising_slash: { ms: 480, keys: [[0.45, "rise_low"], [0.75, "rise_mid", "in"], [1, "rise_end", "out"]], other: [[1, "counter_back", "in"]] },
  thrust: { ms: 420, keys: [[0.6, "thrust_draw"], [1, "thrust_out", "in"]], other: [[0.6, "aim_fwd"], [1, "counter_back", "in"]] },
  blade_out: { ms: 300, keys: [[1, "blade_out"]], other: [[1, "wide"]] },
  cleave: { ms: 620, both: true, keys: [[0.55, "cleave_high"], [1, "cleave_end", "in"]] },
  sweep_both: { ms: 350, both: true, keys: [[1, "sweep_both"]] },
};

// What the caster can hold (space.caster_weapon): blade length and width,
// grip length, in world units (the figure is one unit tall).
export const WEAPONS = {
  sword: { length: 0.5, width: 0.034, grip: 0.07 },
  greatsword: { length: 0.74, width: 0.05, grip: 0.12 },
  dagger: { length: 0.24, width: 0.028, grip: 0.05 },
};

/** Gesture kind -> { duration_ms, two_handed } (for docs and the director). */
export function gestureInfo(kind) {
  const g = GESTURES[kind];
  return g ? { duration_ms: g.ms, two_handed: !!g.both } : null;
}

// ------------------------------------------------------------ vector math

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a, fb = [1, 0, 0]) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : fb.slice();
};
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (u) => u * u * (3 - 2 * u);
const EASE = { in: (u) => u * u * u, out: (u) => 1 - Math.pow(1 - u, 3) };
const mirror = (v, s) => [v[0], v[1], v[2] * s];

// ------------------------------------------------------------ poses

function shapeOf(name) {
  const s = HAND_SHAPES[name] || HAND_SHAPES.open;
  return { curl: s.curl.slice(), spread: s.spread };
}

// The way a held blade points when a pose doesn't say: out of the thumb
// side of the fist, tipped a little toward the knuckles.
function defaultBlade(aim, palm) {
  const n = norm(sub(palm, mul(aim, dot(palm, aim))), [0, 0, -1]);
  return norm(add(mul(cross(aim, n), 0.85), mul(aim, 0.35)));
}

function poseNamed(name, shape) {
  const p = POSES[name] || POSES.hang;
  const sh = shapeOf(shape || p.shape);
  const aim = norm(p.aim);
  const palm = norm(p.palm);
  return { w: p.w.slice(), aim, palm, blade: p.blade ? norm(p.blade) : defaultBlade(aim, palm), curl: sh.curl, spread: sh.spread };
}

function blend(a, b, u) {
  return {
    w: lerp3(a.w, b.w, u),
    aim: norm(lerp3(a.aim, b.aim, u), b.aim),
    palm: norm(lerp3(a.palm, b.palm, u), b.palm),
    blade: norm(lerp3(a.blade, b.blade, u), b.blade),
    curl: a.curl.map((c, i) => lerp(c, b.curl[i], u)),
    spread: lerp(a.spread, b.spread, u),
  };
}

/** The rest pose of an arm: "ready" (the caster's casting hand up in front), "blade" (a sword held up in guard) or "hang". */
export function restPose(rest) {
  return poseNamed(rest === "ready" ? "ready" : rest === "blade" ? "blade_ready" : "hang");
}

// ------------------------------------------------------------ timeline

/**
 * Normalise a gesture list (numbers already resolved) into per-arm tracks.
 * Each item: { kind, at_ms, duration_ms, hand, hold_ms, return_ms, shape }.
 * Returns { lead: [...], off: [...] }, each sorted by start time, where an
 * entry is { at, dur, hold, ret, keys, shape }.
 */
export function gestureTracks(list) {
  const tracks = { lead: [], off: [] };
  for (const g of [].concat(list || [])) {
    const def = GESTURES[g?.kind];
    if (!def) continue;
    const at = Number(g.at_ms) || 0;
    const dur = Math.max(1, Number(g.duration_ms) || def.ms);
    const hold = Number.isFinite(Number(g.hold_ms)) ? Math.max(0, Number(g.hold_ms)) : 250;
    const ret = Number.isFinite(Number(g.return_ms)) ? Math.max(1, Number(g.return_ms)) : 400;
    const entry = (keys, shape) => ({ at, dur, hold, ret, keys, shape });
    const hand = HANDS.includes(g.hand) ? g.hand : "lead";
    if (def.both || hand === "both") {
      tracks.lead.push(entry(def.keys, g.shape));
      tracks.off.push(entry(def.keys, g.shape));
    } else {
      const other = hand === "lead" ? "off" : "lead";
      tracks[hand].push(entry(def.keys, g.shape));
      if (def.other) tracks[other].push(entry(def.other, null));
    }
  }
  for (const k of ["lead", "off"]) tracks[k].sort((a, b) => a.at - b.at);
  return tracks;
}

/**
 * One arm's pose at time t: its gestures in order, each starting from
 * wherever the arm was when it began, holding its last key for hold_ms and
 * easing back to rest over return_ms (unless the next gesture takes over).
 */
export function armPose(track, rest, t) {
  const restP = restPose(rest);
  let fn = () => restP;
  for (const g of track || []) {
    if (!(t >= g.at)) break;
    const start = fn(g.at);
    const keys = g.keys.map(([u, name, ease], i) => {
      const last = i === g.keys.length - 1;
      const pose = name === "rest" ? restP : poseNamed(name, last ? g.shape : null);
      return { u, pose, ease };
    });
    const end = keys[keys.length - 1].pose;
    fn = (tt) => {
      const u = (tt - g.at) / g.dur;
      if (u < 1) {
        let prevU = 0;
        let prev = start;
        for (const k of keys) {
          if (u <= k.u) {
            const f = clamp01((u - prevU) / Math.max(1e-6, k.u - prevU));
            return blend(prev, k.pose, (EASE[k.ease] || smooth)(f));
          }
          prevU = k.u;
          prev = k.pose;
        }
        return end;
      }
      const after = tt - g.at - g.dur - g.hold;
      if (after <= 0) return end;
      return blend(end, restP, smooth(clamp01(after / g.ret)));
    };
  }
  return fn(t);
}

// ------------------------------------------------------------ the arm

// Two-bone reach from the shoulder to the wrist; the elbow bends toward
// `pole` (down, back and out).
function solveElbow(S, W, pole) {
  const { upper: U, fore: F } = BODY;
  let d = sub(W, S);
  let dist = len(d);
  const dir = norm(d, [0, -1, 0]);
  const max = U + F - 1e-4;
  const min = Math.abs(U - F) + 0.02;
  if (dist > max) dist = max;
  if (dist < min) dist = min;
  const wrist = add(S, mul(dir, dist));
  const a = (U * U - F * F + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, U * U - a * a));
  let p = sub(pole, mul(dir, dot(pole, dir)));
  if (len(p) < 1e-5) p = sub([0, -1, 0], mul(dir, dir[1] * -1));
  p = norm(p, [0, -1, 0]);
  return { elbow: add(add(S, mul(dir, a)), mul(p, h)), wrist };
}

// Bend `v` toward `n` by angle `a` (both unit and roughly at right angles).
const bend = (v, n, a) => norm(add(mul(v, Math.cos(a)), mul(n, Math.sin(a))));
const DEG = Math.PI / 180;

/**
 * Forward kinematics for one arm in a pose. side: -1 for the lead arm (on
 * -Z), +1 for the off arm. Returns joint positions (body coords):
 * { shoulder, elbow, wrist, palm: { center, aim, normal, thumb }, fingers:
 * [[base, mid, tip] x5 (thumb first)], hand (the emit point just off the
 * palm), tip (the index fingertip) }.
 */
export function armFK(pose, side) {
  const s = side < 0 ? -1 : 1;
  const S = mirror(BODY.shoulder, s);
  const target = mirror(pose.w, s);
  const { elbow, wrist } = solveElbow(S, target, mirror([-0.35, -1, 0.55], s));
  const aim = norm(mirror(pose.aim, s));
  let n = mirror(pose.palm, s);
  n = norm(sub(n, mul(aim, dot(n, aim))), cross(aim, [0, 0, s]));
  const thumb = norm(mul(cross(aim, n), s));
  const center = add(wrist, mul(aim, BODY.palmLen / 2));
  const knuckles = add(wrist, mul(aim, BODY.palmLen));
  const fingers = [];
  // Thumb: from the heel of the palm on the thumb side, out and forward,
  // curling across the palm.
  {
    const c = pose.curl[0];
    const base = add(add(wrist, mul(aim, 0.018)), mul(thumb, BODY.palmWidth * 0.45));
    const open = norm(add(add(mul(aim, 0.6), mul(thumb, 0.75)), mul(n, 0.25)));
    const across = norm(add(add(mul(n, 0.6), mul(thumb, -0.6)), mul(aim, 0.5)));
    const d1 = norm(lerp3(open, across, c * 0.8));
    const d2 = norm(lerp3(d1, across, 0.3 + c * 0.6));
    const L = BODY.fingers[0];
    const mid = add(base, mul(d1, L * 0.55));
    fingers.push([base, mid, add(mid, mul(d2, L * 0.45))]);
  }
  const offsets = [0.38, 0.13, -0.13, -0.38];
  for (let i = 0; i < 4; i++) {
    const c = pose.curl[i + 1];
    const base = add(knuckles, mul(thumb, offsets[i] * BODY.palmWidth));
    const f0 = norm(add(aim, mul(thumb, offsets[i] * pose.spread * 0.9)));
    const d1 = bend(f0, n, c * 80 * DEG);
    const d2 = bend(f0, n, c * 175 * DEG);
    const L = BODY.fingers[i + 1];
    const mid = add(base, mul(d1, L * 0.55));
    fingers.push([base, mid, add(mid, mul(d2, L * 0.45))]);
  }
  return {
    shoulder: S,
    elbow,
    wrist,
    palm: { center, aim, normal: n, thumb },
    fingers,
    hand: add(center, mul(n, 0.025)),
    tip: fingers[1][2],
    // The way a blade held in this hand points (see bladeFK).
    blade: norm(mirror(pose.blade || defaultBlade(norm(pose.aim), norm(pose.palm)), s)),
  };
}

/**
 * A blade held in a hand (armFK's result): { pommel, guard, mid, tip, dir }
 * in body coords. weapon: { kind, length } with kind a WEAPONS name (sword by
 * default) and length (world units) overriding its blade length.
 */
export function bladeFK(fk, weapon) {
  const w = WEAPONS[weapon?.kind] || WEAPONS.sword;
  const L = Number(weapon?.length) > 0 ? Number(weapon.length) : w.length;
  const d = fk.blade;
  const guard = add(fk.palm.center, mul(d, BODY.palmWidth * 0.62));
  const tip = add(guard, mul(d, L));
  return {
    pommel: add(fk.palm.center, mul(d, -w.grip)),
    guard,
    mid: add(guard, mul(d, L * 0.55)),
    tip,
    dir: d,
    width: w.width,
  };
}

/**
 * Both arms of a figure at time t. tracks: from gestureTracks. rest: the
 * lead arm's rest pose ("ready" for a caster, "hang" otherwise; the off arm
 * always hangs). Returns { lead, off } from armFK (body coords).
 */
export function armsAt(tracks, t, rest = "hang", weapon = null) {
  const lead = armFK(armPose(tracks?.lead, rest, t), -1);
  const arms = { lead, off: armFK(armPose(tracks?.off, "hang", t), 1) };
  if (weapon) arms.blade = bladeFK(lead, weapon);
  return arms;
}

/**
 * The gestures a stand-in's reaction implies (engine/react.js), starting at
 * `at` ms: arms flung up when knocked back, a guard when flinching or
 * cowering, fists up when cheering, arms wide when the caster shouts.
 */
export function reactionGestures(react, at = 0) {
  if (!react) return [];
  const d = Number(react.duration_ms);
  switch (react.kind) {
    case "knockback":
      return [{ kind: "flail", at_ms: at, hold_ms: Math.max(0, (d || 520) - 300) }];
    case "flinch":
      return [{ kind: "guard", at_ms: at, duration_ms: 150, hold_ms: Math.max(0, (d || 420) * 0.4) }];
    case "cower":
      return [{ kind: "guard", at_ms: at, hold_ms: Math.max(0, (d || 1400) - 550), return_ms: 300 }];
    case "cheer":
      return [{ kind: "cheer", at_ms: at, duration_ms: 200, hold_ms: Math.max(0, (d || 700) - 300) }];
    case "lunge":
      return [{ kind: "push", at_ms: at, duration_ms: 220, hold_ms: Math.max(0, (d || 600) * 0.4) }];
    case "leap":
      return [{ kind: "flail", at_ms: at, hold_ms: Math.max(0, (d || 700) * 0.5) }];
    case "spin":
      return [{ kind: "flail", at_ms: at, duration_ms: 200, hold_ms: Math.max(0, (d || 600) - 300) }];
    case "shout": {
      const dur = d || 900;
      return [{ kind: "roar", at_ms: at, duration_ms: dur * 0.52, hold_ms: dur * 0.25 }];
    }
    default:
      return [];
  }
}
