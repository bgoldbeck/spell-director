// How the stand-in figures react to a spell: an enemy knocked back by a
// roar, flinching from a thunderclap or cowering from a howl, an ally
// hopping as a rallying shout lifts them, the caster rearing back and
// shouting. Pure math (no Three.js), so Node can test it and the studio
// poses its figures with it. The viewer stays a pure function of time: a
// pose depends only on the reaction and the ms since it started.

export const REACTION_KINDS = ["knockback", "flinch", "cower", "cheer", "shout", "lunge", "leap", "spin"];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
const smooth = (u) => u * u * (3 - 2 * u);
const DEG = Math.PI / 180;

// The default length of each kind, in ms.
const DURATION = { knockback: 520, flinch: 420, cower: 1400, cheer: 700, shout: 900, lunge: 600, leap: 700, spin: 600 };

/** A rest pose: no push, no lean, no lift, full height. */
export const REST = Object.freeze({ push: 0, lean: 0, lift: 0, squash: 1, shiver: 0, yaw: 0 });

/**
 * The pose `ms` after a reaction started (negative = not yet).
 * Returns { push, lean, lift, squash, shiver }:
 * - push: world units moved away from the spell's centre (knockback stays pushed);
 * - lean: radians, the top tipped away from the centre (negative leans in);
 * - lift: world units off the ground (a stagger hop, a cheer);
 * - squash: height scale (a crouch);
 * - shiver: world units sideways (trembling);
 * - yaw: radians turned about the figure's own vertical axis (a spin).
 * For the caster, "away" is backward, so a lunge's push is negative.
 * `react` is { kind, duration_ms, distance_px, lean_deg, lift_px, hops, turns } with
 * template pixels (100 px = one world unit).
 */
export function reactionPose(react, ms) {
  if (!react || !REACTION_KINDS.includes(react.kind) || !(ms >= 0)) return { ...REST };
  const dur = Math.max(1, Number(react.duration_ms) || DURATION[react.kind]);
  const u = clamp01(ms / dur);
  const px = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d) / 100;
  const deg = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d) * DEG;
  const pose = { ...REST };
  switch (react.kind) {
    case "knockback": {
      // Shoved back off their feet: a fast slide that slows, a little hop,
      // tipped back by the blow and righting themselves as they land.
      const dist = px(react.distance_px, 90);
      pose.push = dist * easeOut(u);
      pose.lift = dist * 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.4));
      pose.lean = deg(react.lean_deg, 32) * (u < 1 ? Math.pow(Math.sin(Math.PI * u), 0.6) : 0);
      break;
    }
    case "flinch": {
      // Rocked back by the blast and swaying upright again.
      const L = deg(react.lean_deg, 18);
      if (u < 0.3) pose.lean = L * Math.sin((Math.PI / 2) * (u / 0.3));
      else if (u < 1) pose.lean = L * Math.cos(1.5 * Math.PI * ((u - 0.3) / 0.7)) * (1 - (u - 0.3) / 0.7);
      pose.push = px(react.distance_px, 6) * Math.sin(Math.PI * u);
      break;
    }
    case "cower": {
      // Shrinking away: crouched, leaning back and trembling, then
      // straightening up when the fear lets go (the last 300 ms).
      const rel = Math.min(300, dur * 0.3);
      const env = ms < 220 ? smooth(ms / 220) : ms > dur - rel ? smooth(clamp01((dur - ms) / rel)) : 1;
      pose.lean = deg(react.lean_deg, 14) * env;
      pose.squash = 1 - 0.2 * env;
      pose.shiver = 0.014 * env * Math.sin(2 * Math.PI * 13 * (ms / 1000));
      pose.push = px(react.distance_px, 12) * env;
      break;
    }
    case "cheer": {
      // Hopping on the spot, stretched tall at the top of each hop.
      const hops = Math.max(1, Math.round(Number(react.hops) || 2));
      const h = Math.abs(Math.sin(Math.PI * hops * u));
      pose.lift = u < 1 ? px(react.lift_px, 14) * h : 0;
      pose.squash = u < 1 ? 1 + 0.08 * h - 0.1 * Math.pow(1 - h, 6) : 1;
      pose.lean = u < 1 ? -deg(react.lean_deg, 6) * h : 0;
      break;
    }
    case "shout": {
      // The caster rears back drawing breath (first 40%), then throws the
      // chest forward with the shout and settles.
      const L = deg(react.lean_deg, 16);
      const back = u < 0.4 ? smooth(u / 0.4) : 1 - smooth(clamp01((u - 0.4) / 0.12));
      const fwd = u < 0.4 ? 0 : u < 0.52 ? smooth((u - 0.4) / 0.12) : 1 - smooth(clamp01((u - 0.7) / 0.3));
      // Lean is "away from the centre"; for the caster that is backward.
      pose.lean = L * 0.8 * back - L * fwd;
      pose.squash = 1 - 0.05 * back + 0.04 * fwd;
      break;
    }
    case "lunge": {
      // A step in toward the centre (the caster: forward) and a lean into
      // it over the first 35%, held, then a step back over the last 30%.
      const env = u < 0.35 ? easeOut(u / 0.35) : u < 0.7 ? 1 : 1 - smooth((u - 0.7) / 0.3);
      pose.push = -px(react.distance_px, 45) * env;
      pose.lean = -deg(react.lean_deg, 14) * env;
      pose.squash = 1 - 0.07 * env;
      break;
    }
    case "leap": {
      // Up and in (the caster: forward) in an arc over the first 70%, a
      // crouch on landing, then upright where they landed.
      const a = clamp01(u / 0.7);
      pose.push = -px(react.distance_px, 80) * smooth(a);
      pose.lift = u < 0.7 ? px(react.lift_px, 45) * Math.sin(Math.PI * a) : 0;
      pose.lean = -deg(react.lean_deg, 12) * Math.sin(Math.PI * a) * (u < 0.7 ? 1 : 0);
      const land = u >= 0.7 ? Math.sin(Math.PI * clamp01((u - 0.7) / 0.3)) : 0;
      pose.squash = 1 - 0.14 * land;
      break;
    }
    case "spin": {
      // Whole turns about the vertical axis (negative turns: clockwise seen
      // from above), easing in and out, a little crouched while spinning.
      // Up to speed over the first 12% and down over the last 12%, steady
      // between, so a blade held out sweeps round at an even pace.
      const turns = Number.isFinite(Number(react.turns)) ? Number(react.turns) : 1;
      const a = 0.12;
      const f = u < a ? (u * u) / (2 * a) : u > 1 - a ? 1 - a - (1 - u) * (1 - u) / (2 * a) : u - a / 2;
      pose.yaw = 2 * Math.PI * turns * (f / (1 - a));
      pose.squash = u < 1 ? 1 - 0.06 * Math.sin(Math.PI * u) : 1;
      pose.lean = -deg(react.lean_deg, 0) * (u < 1 ? Math.sin(Math.PI * u) : 0);
      break;
    }
  }
  return pose;
}

/**
 * Several reactions at once (a caster who lunges, then spins): their poses
 * added together (push, lean, lift, shiver, yaw) and their squashes multiplied.
 * `ats`: each reaction's start (ms). Returns a single pose like reactionPose.
 */
export function combinedPose(reacts, ats, ms) {
  const out = { ...REST };
  reacts.forEach((r, i) => {
    const p = reactionPose(r, ms - (ats[i] || 0));
    out.push += p.push;
    out.lean += p.lean;
    out.lift += p.lift;
    out.shiver += p.shiver;
    out.yaw += p.yaw;
    out.squash *= p.squash;
  });
  return out;
}
