// How the stand-in figures react to a spell: an enemy knocked back by a
// roar, flinching from a thunderclap or cowering from a howl, an ally
// hopping as a rallying shout lifts them, the caster rearing back and
// shouting. Pure math (no Three.js), so Node can test it and the studio
// poses its figures with it. The viewer stays a pure function of time: a
// pose depends only on the reaction and the ms since it started.

export const REACTION_KINDS = ["knockback", "flinch", "cower", "cheer", "shout"];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
const smooth = (u) => u * u * (3 - 2 * u);
const DEG = Math.PI / 180;

// The default length of each kind, in ms.
const DURATION = { knockback: 520, flinch: 420, cower: 1400, cheer: 700, shout: 900 };

/** A rest pose: no push, no lean, no lift, full height. */
export const REST = Object.freeze({ push: 0, lean: 0, lift: 0, squash: 1, shiver: 0 });

/**
 * The pose `ms` after a reaction started (negative = not yet).
 * Returns { push, lean, lift, squash, shiver }:
 * - push: world units moved away from the spell's centre (knockback stays pushed);
 * - lean: radians, the top tipped away from the centre (negative leans in);
 * - lift: world units off the ground (a stagger hop, a cheer);
 * - squash: height scale (a crouch);
 * - shiver: world units sideways (trembling).
 * `react` is { kind, duration_ms, distance_px, lean_deg, lift_px, hops } with
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
  }
  return pose;
}
