// The caster's skeleton, laid out and named like Mixamo's (the "mixamorig:"
// bones: Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder, LeftArm,
// LeftForeArm, LeftHand, LeftHandIndex1..4 and so on), so animation moves
// both ways:
//
// - out: the caster's gestures (engine/gesture.js) become bone rotations,
//   baked into a clip (exported as a GLB and a clip file, engine/rigexport.js)
//   that Unity imports as a Humanoid and plays on any character;
// - in: a Mixamo animation (converted once by web/js/clipimport.js into a
//   "spelldirector.clip/1" file) drives the caster's arms, hands and fingers,
//   and the hand anchors the effects use follow it.
//
// Pure math (no Three.js), so Node can test it. The viewer stays a pure
// function of time: a pose depends only on the gestures or the clip, and t.
//
// Frame: the figure is one unit tall, stands at the origin facing +X, up +Y.
// Its left side is -Z: the lead (casting) arm of engine/gesture.js is the
// LEFT arm, the off arm the right. A rig pose is { rot: { bone: quaternion },
// hips: [x, y, z] }: each bone's world rotation as a change from the rest
// T-pose (all bones' rest rotations are the identity), and how far the hips
// have moved from rest, in figure heights. Quaternions are [x, y, z, w].

import { BODY, armFK, defaultBlade } from "./gesture.js";

export const MIXAMO_PREFIX = "mixamorig:";
export const CLIP_FORMAT = "spelldirector.clip/1";
export const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
export const SIDES = { Left: "lead", Right: "off" };
// The extra bone a held blade rides on (child of LeftHand). Not a Mixamo or
// Humanoid bone: engines keep it as a plain transform.
export const WEAPON_BONE = "Weapon";

// [bone, parent], parents first.
export const BONES = (() => {
  const list = [
    ["Hips", null],
    ["Spine", "Hips"],
    ["Spine1", "Spine"],
    ["Spine2", "Spine1"],
    ["Neck", "Spine2"],
    ["Head", "Neck"],
    ["HeadTop_End", "Head"],
  ];
  for (const side of ["Left", "Right"]) {
    list.push([`${side}Shoulder`, "Spine2"], [`${side}Arm`, `${side}Shoulder`], [`${side}ForeArm`, `${side}Arm`], [`${side}Hand`, `${side}ForeArm`]);
    for (const f of FINGER_NAMES) {
      for (let k = 1; k <= 4; k++) list.push([`${side}Hand${f}${k}`, k === 1 ? `${side}Hand` : `${side}Hand${f}${k - 1}`]);
    }
  }
  for (const side of ["Left", "Right"]) {
    list.push([`${side}UpLeg`, "Hips"], [`${side}Leg`, `${side}UpLeg`], [`${side}Foot`, `${side}Leg`], [`${side}ToeBase`, `${side}Foot`], [`${side}Toe_End`, `${side}ToeBase`]);
  }
  return list;
})();
export const BONE_NAMES = BONES.map((b) => b[0]);
export const PARENT = Object.fromEntries(BONES);
export const ALL_BONES = [...BONE_NAMES, WEAPON_BONE];
PARENT[WEAPON_BONE] = "LeftHand";

/** The bone's full Mixamo name ("mixamorig:LeftHand"); the weapon bone keeps its own. */
export const mixamoName = (bone) => (bone === WEAPON_BONE ? "SpellDirector_Weapon" : MIXAMO_PREFIX + bone);

/**
 * The bare bone name for any Mixamo-style name: "mixamorig:LeftHand",
 * "mixamorig1:LeftHand", "mixamorigLeftHand" (Three.js loaders drop the
 * colon), "Armature|mixamorig:LeftHand" or plain "LeftHand" -> "LeftHand".
 * Null if it is none of ours.
 */
export function canonicalBone(name) {
  if (!name) return null;
  let n = String(name).split(/[|/]/).pop();
  n = n.replace(/^.*?mixamorig\d*[:_]?/i, "");
  if (/^SpellDirector_?Weapon$/i.test(n)) return WEAPON_BONE;
  const hit = BONE_NAMES.find((b) => b.toLowerCase() === n.toLowerCase());
  return hit || null;
}

// ------------------------------------------------------------ vector and quaternion math

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
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Part of v at right angles to the unit vector p.
const perp = (v, p) => sub(v, mul(p, dot(v, p)));

export const QI = [0, 0, 0, 1];
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? q.map((v) => v / l) : QI.slice();
}
/** Rotate vector v by unit quaternion q. */
export function qrot(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, q[3])), cross(u, t));
}
export function qslerp(a, b, u) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = b.map((v) => -v);
  }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (bb[i] - v) * u));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - u) * th) / s;
  const kb = Math.sin(u * th) / s;
  return a.map((v, i) => v * ka + bb[i] * kb);
}
export function qaxis(axis, angle) {
  const n = norm(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}
/** Quaternion of the rotation matrix with columns x, y, z (orthonormal, right-handed). */
export function qfromBasis(x, y, z) {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnorm(q);
}
// The rotation of a frame whose first axis is p, second the part of s at
// right angles to p (fallback f when s runs along p).
function frameQ(p, s, f = [0, 1, 0]) {
  const x = norm(p);
  let y = perp(s, x);
  if (len(y) < 1e-4) y = perp(f, x);
  if (len(y) < 1e-4) y = perp([0, 0, 1], x);
  y = norm(y);
  return qfromBasis(x, y, cross(x, y));
}
// The rotation that takes a rest frame (p0, s0) to the frame (p, s).
const deltaQ = (p0, s0, p, s) => qnorm(qmul(frameQ(p, s), qconj(frameQ(p0, s0))));

// ------------------------------------------------------------ the rest skeleton

const SPINE = {
  Hips: [0, 0.46, 0],
  Spine: [0, 0.52, 0],
  Spine1: [0, 0.57, 0],
  Spine2: [0, 0.62, 0],
  Neck: [0, 0.72, 0],
  Head: [0, 0.78, 0],
  HeadTop_End: [0, 0.99, 0],
};
// Legs, left side (-Z); the right side is mirrored. Hidden in the stand-in's
// body, but there for a full Humanoid.
const LEG = {
  UpLeg: [0, 0.43, -0.08],
  Leg: [0, 0.235, -0.08],
  Foot: [0, 0.045, -0.08],
  ToeBase: [0.075, 0.012, -0.08],
  Toe_End: [0.125, 0.012, -0.08],
};

// The rest arm: a T-pose, held straight out to the side, palm down, fingers
// straight and a little apart.
function restArm(side) {
  const s = side < 0 ? -1 : 1;
  const reach = BODY.upper + BODY.fore;
  const out = BODY.shoulder[2] + reach;
  const aim = [0, 0, 1];
  const palm = [0, -1, 0];
  const pose = { w: [0, BODY.shoulder[1], out], aim, palm, blade: defaultBlade(aim, palm), curl: [0, 0, 0, 0, 0], spread: 0.15 };
  const fk = armFK(pose, s);
  // Straighten the elbow exactly (the two-bone solve keeps a hair of bend).
  const S = fk.shoulder;
  const dir = [0, 0, s];
  const wrist = add(S, mul(dir, reach));
  const shift = sub(wrist, fk.wrist);
  const mv = (p) => add(p, shift);
  return {
    shoulder: S,
    elbow: add(S, mul(dir, BODY.upper)),
    wrist,
    palm: { ...fk.palm, center: mv(fk.palm.center) },
    fingers: fk.fingers.map((f) => f.map(mv)),
    hand: mv(fk.hand),
    tip: mv(fk.tip),
    blade: fk.blade,
  };
}

function buildRest() {
  const pos = { ...SPINE };
  const arms = { Left: restArm(-1), Right: restArm(1) };
  for (const side of ["Left", "Right"]) {
    const s = side === "Left" ? -1 : 1;
    const a = arms[side];
    pos[`${side}Shoulder`] = [0, BODY.shoulder[1] - 0.005, 0.06 * s];
    pos[`${side}Arm`] = a.shoulder;
    pos[`${side}ForeArm`] = a.elbow;
    pos[`${side}Hand`] = a.wrist;
    FINGER_NAMES.forEach((f, i) => a.fingers[i].forEach((p, k) => (pos[`${side}Hand${f}${k + 1}`] = p)));
  }
  // Legs: the left at -Z, the right mirrored to +Z.
  for (const [k, v] of Object.entries(LEG)) {
    pos[`Left${k}`] = [v[0], v[1], v[2]];
    pos[`Right${k}`] = [v[0], v[1], -v[2]];
  }
  pos[WEAPON_BONE] = arms.Left.palm.center;
  return { pos, arms };
}

/** The rest T-pose: { pos: { bone: [x, y, z] } (body coords), arms: { Left, Right } (armFK-like) }. */
export const REST = buildRest();

/** Height of the figure (the top of the head end bone), in figure units. */
export const FIGURE_HEIGHT = 1;

// ------------------------------------------------------------ arms -> rig

function sideRot(side, fk, rest, rot, weapon) {
  const s = side === "Left" ? -1 : 1;
  const fwd = [1, 0, 0];
  // Upper arm: along shoulder -> elbow, turned so the elbow bends where it bends.
  const p0 = norm(sub(rest.elbow, rest.shoulder));
  const bn0 = norm(cross(p0, fwd));
  const p = norm(sub(fk.elbow, fk.shoulder));
  const f = norm(sub(fk.wrist, fk.elbow));
  const c = cross(p, f);
  const bent = clamp01(len(c) / 0.25);
  // A straight arm has no bend: the palm says which way it is turned.
  const fallback = mul(perp(fk.palm.normal, p), s < 0 ? 1 : -1);
  const bn = add(mul(norm(c, fallback), bent), mul(norm(fallback, bn0), 1 - bent));
  rot[`${side}Arm`] = deltaQ(p0, bn0, p, bn);
  // Forearm: along elbow -> wrist, turned with the palm.
  const f0 = norm(sub(rest.wrist, rest.elbow));
  rot[`${side}ForeArm`] = deltaQ(f0, rest.palm.normal, f, fk.palm.normal);
  // Hand: the way the fingers point and the palm faces.
  const hand = deltaQ(rest.palm.aim, rest.palm.normal, fk.palm.aim, fk.palm.normal);
  rot[`${side}Hand`] = hand;
  FINGER_NAMES.forEach((name, i) => {
    const R = rest.fingers[i];
    const P = fk.fingers[i];
    for (let k = 0; k < 3; k++) {
      rot[`${side}Hand${name}${k + 1}`] = deltaQ(sub(R[k + 1], R[k]), rest.palm.normal, sub(P[k + 1], P[k]), fk.palm.normal);
    }
    rot[`${side}Hand${name}4`] = rot[`${side}Hand${name}3`];
  });
  if (weapon && fk.blade) {
    // The blade's edge runs the way the knuckles point (as the studio draws it).
    rot[WEAPON_BONE] = deltaQ(rest.blade, rest.palm.aim, fk.blade, fk.palm.aim);
  }
}

/**
 * The rig pose for a pair of arms from engine/gesture.js armsAt (body
 * coords): every bone's rotation from the rest T-pose. The body itself
 * stays at rest (the stand-in's reaction moves it as a whole, see rootOf).
 */
export function rigFromArms(arms) {
  const rot = {};
  for (const b of BONE_NAMES) rot[b] = QI.slice();
  sideRot("Left", arms.lead, REST.arms.Left, rot, !!arms.blade);
  sideRot("Right", arms.off, REST.arms.Right, rot, false);
  if (!rot[WEAPON_BONE]) rot[WEAPON_BONE] = rot.LeftHand.slice();
  return { rot, hips: [0, 0, 0] };
}

// ------------------------------------------------------------ rig -> joints

/** Every bone's position (body coords) in a rig pose: forward kinematics from the rest skeleton. */
export function rigPositions(rig) {
  const pos = {};
  const rot = (b) => rig.rot[b] || (PARENT[b] ? rot(PARENT[b]) : QI);
  for (const b of ALL_BONES) {
    const parent = PARENT[b];
    if (!parent) {
      pos[b] = add(REST.pos[b], rig.hips || [0, 0, 0]);
      continue;
    }
    pos[b] = add(pos[parent], qrot(rot(parent), sub(REST.pos[b], REST.pos[parent])));
  }
  return pos;
}

function armFromRig(side, rig, pos) {
  const rest = REST.arms[side];
  const r = (b) => rig.rot[b] || QI;
  const hand = r(`${side}Hand`);
  const aim = qrot(hand, rest.palm.aim);
  const normal = qrot(hand, rest.palm.normal);
  const thumb = qrot(hand, rest.palm.thumb);
  const wrist = pos[`${side}Hand`];
  const center = add(wrist, mul(aim, BODY.palmLen / 2));
  const fingers = FINGER_NAMES.map((f) => [1, 2, 3, 4].map((k) => pos[`${side}Hand${f}${k}`]));
  return {
    shoulder: pos[`${side}Arm`],
    elbow: pos[`${side}ForeArm`],
    wrist,
    palm: { center, aim, normal, thumb },
    fingers,
    hand: add(center, mul(normal, 0.025)),
    tip: fingers[1][3],
    blade: side === "Left" ? qrot(rig.rot[WEAPON_BONE] || hand, rest.blade) : defaultBlade(aim, normal),
  };
}

/**
 * The arms (shaped like engine/gesture.js armsAt: { lead, off }) of a rig
 * pose, plus `body`: where the hips are and how the chest and head turn, for
 * the stand-in's torso.
 */
export function armsFromRig(rig) {
  const pos = rigPositions(rig);
  return {
    lead: armFromRig("Left", rig, pos),
    off: armFromRig("Right", rig, pos),
    body: { hips: pos.Hips, chest: rig.rot.Spine2 || QI, head: rig.rot.Head || QI },
  };
}

/** Blend two rig poses (u = 0 is a, 1 is b). */
export function blendRig(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const rot = {};
  for (const k of ALL_BONES) rot[k] = qslerp(a.rot[k] || QI, b.rot[k] || QI, u);
  const ha = a.hips || [0, 0, 0];
  const hb = b.hips || [0, 0, 0];
  return { rot, hips: ha.map((v, i) => v + (hb[i] - v) * u) };
}

// ------------------------------------------------------------ the stand-in's reaction

/**
 * The whole-body move of a reaction pose (engine/react.js: push, lift, lean,
 * yaw; squash is left out, a skeleton can't squash) for a figure at (x, z)
 * pushed along `away`: { rot, pos } to apply to the whole rig, about the feet.
 * Same transform as stage.js bodyToWorld.
 */
export function rootOf(pose, away = [-1, 0, 0]) {
  if (!pose) return { rot: QI.slice(), pos: [0, 0, 0] };
  const ax = norm(cross([0, 1, 0], away), [0, 0, 1]);
  let q = qaxis(ax, pose.lean || 0);
  if (pose.yaw) q = qmul(q, qaxis([0, 1, 0], pose.yaw));
  return {
    rot: qnorm(q),
    pos: [away[0] * (pose.push || 0) - away[2] * (pose.shiver || 0), pose.lift || 0, away[2] * (pose.push || 0) + away[0] * (pose.shiver || 0)],
  };
}

/** A rig pose with a root move folded into the hips (and every bone's rotation). */
export function applyRoot(rig, root) {
  if (!root) return rig;
  const rot = {};
  for (const k of ALL_BONES) rot[k] = qnorm(qmul(root.rot, rig.rot[k] || QI));
  // The hips turn about the feet (the origin) and move.
  const hipsRest = REST.pos.Hips;
  const hipsNow = add(hipsRest, rig.hips || [0, 0, 0]);
  const moved = add(qrot(root.rot, hipsNow), root.pos);
  return { rot, hips: sub(moved, hipsRest) };
}

// ------------------------------------------------------------ clips

const r5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Bake rig poses into a clip ("spelldirector.clip/1"). frames: rig poses at
 * fps. meta: { name, source, loop }.
 */
export function makeClip(frames, fps, meta = {}) {
  // A bone the clip leaves out follows its parent (sampleClip), so only bones
  // that ever turn differently from their parent are kept.
  const eff = frames.map(() => ({}));
  const rotations = {};
  for (const b of ALL_BONES) {
    const parent = PARENT[b];
    const out = [];
    let own = !parent;
    frames.forEach((fr, i) => {
      const q = fr.rot[b] || (parent ? eff[i][parent] : QI);
      eff[i][b] = q;
      if (parent && Math.abs(q[0] * eff[i][parent][0] + q[1] * eff[i][parent][1] + q[2] * eff[i][parent][2] + q[3] * eff[i][parent][3]) < 0.99999) own = true;
      out.push(...q.map(r5));
    });
    if (own) rotations[b] = out;
  }
  return {
    format: CLIP_FORMAT,
    name: meta.name || "clip",
    source: meta.source || "spelldirector",
    fps,
    frame_count: frames.length,
    duration_ms: Math.round(((Math.max(1, frames.length) - 1) / fps) * 1000 * 1000) / 1000,
    loop: !!meta.loop,
    space:
      "SpellDirector body space: one unit = figure height, +X forward, +Y up, -Z the figure's left. rotations: each bone's world rotation as a change from the rest T-pose, quaternions [x, y, z, w] per frame. hips: hips offset from rest per frame. Bones not listed follow their parent.",
    bones: Object.keys(rotations),
    rotations,
    hips: frames.flatMap((fr) => (fr.hips || [0, 0, 0]).map(r5)),
  };
}

/** Is this a usable clip? */
export function isClip(clip) {
  return !!clip && clip.format === CLIP_FORMAT && clip.fps > 0 && clip.frame_count > 0 && clip.rotations && typeof clip.rotations === "object";
}

/**
 * The rig pose of a clip at clip time ms (clamped to its ends; a looping clip
 * wraps). mirror: play it on the other side (a right-handed throw thrown
 * with the left, the lead, hand).
 */
export function sampleClip(clip, ms, { mirror = false } = {}) {
  const n = clip.frame_count;
  let f = (ms / 1000) * clip.fps;
  if (clip.loop && n > 1) f = ((f % (n - 1)) + (n - 1)) % (n - 1);
  f = Math.max(0, Math.min(n - 1, f));
  const i0 = Math.floor(f);
  const i1 = Math.min(n - 1, i0 + 1);
  const u = f - i0;
  const at = (arr, i, k) => arr.slice(i * k, i * k + k);
  const rot = {};
  for (const b of ALL_BONES) {
    const src = mirror ? mirrorName(b) : b;
    const arr = clip.rotations[src];
    if (!arr) continue;
    let q = qslerp(at(arr, i0, 4), at(arr, i1, 4), u);
    // Mirrored across the body's middle (the XY plane).
    if (mirror) q = [-q[0], -q[1], q[2], q[3]];
    rot[b] = q;
  }
  // Bones the clip leaves out follow their parent.
  for (const b of ALL_BONES) if (!rot[b]) rot[b] = PARENT[b] ? rot[PARENT[b]].slice() : QI.slice();
  const h0 = clip.hips ? at(clip.hips, i0, 3) : [0, 0, 0];
  const h1 = clip.hips ? at(clip.hips, i1, 3) : [0, 0, 0];
  const hips = h0.map((v, i) => (v || 0) + ((h1[i] || 0) - (v || 0)) * u);
  if (mirror) hips[2] = -hips[2];
  return { rot, hips };
}

function mirrorName(b) {
  if (b.startsWith("Left")) return `Right${b.slice(4)}`;
  if (b.startsWith("Right")) return `Left${b.slice(5)}`;
  return b;
}

/**
 * How a template's space.caster_clip plays at spell time t: { ms (clip
 * time), weight (0-1, blending from the gestures into the clip and back) }.
 * def: { clip, at_ms, from_ms, to_ms, speed, blend_ms, hold_ms }.
 */
export function clipPlayback(def, clip, t) {
  const at = Number(def.at_ms) || 0;
  const speed = Number(def.speed) > 0 ? Number(def.speed) : 1;
  const from = Math.max(0, Number(def.from_ms) || 0);
  const to = Number.isFinite(Number(def.to_ms)) && def.to_ms != null ? Math.min(clip.duration_ms, Number(def.to_ms)) : clip.duration_ms;
  const span = Math.max(1, (to - from) / speed);
  const blend = Number.isFinite(Number(def.blend_ms)) && def.blend_ms != null ? Math.max(0, Number(def.blend_ms)) : 150;
  const hold = Number.isFinite(Number(def.hold_ms)) && def.hold_ms != null ? Math.max(0, Number(def.hold_ms)) : 0;
  const local = t - at;
  const ms = clip.loop ? from + Math.max(0, local) * speed : from + Math.max(0, Math.min(span, local)) * speed;
  const end = span + hold;
  let weight;
  if (local < 0) weight = blend > 0 ? clamp01(1 + local / blend) : 0;
  else if (clip.loop || local <= end) weight = 1;
  else weight = blend > 0 ? clamp01(1 - (local - end) / blend) : 0;
  const ease = (x) => x * x * (3 - 2 * x);
  return { ms, weight: ease(weight) };
}
