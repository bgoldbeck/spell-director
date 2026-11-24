// Where things are in the 3D scene. One unit = one character height.
// The caster stands at the origin facing +X.

import * as THREE from "three";
import { resolveValue, rng, seedFor } from "./timeline.js";
import { isSplash, splashLayout } from "./splash.js";
import { isStatus } from "./status.js";
import { combinedPose, REST } from "./react.js";
import { HAND_ANCHORS, armsAt, bladeFK, gestureTracks, isHandAnchor, reactionGestures } from "./gesture.js";
import { applyRoot, armsFromRig, blendRig, clipPlayback, isClip, rigFromArms, rootOf, sampleClip } from "./rig.js";
import { getClip } from "./clips.js";

export { isStatus };

export const PX = 0.01; // template pixel sizes -> world units

export { HAND_ANCHORS, isHandAnchor };

// The caster's gestures with their numbers resolved (ranges picked by seed).
export function resolveGestures(list, seed) {
  return [].concat(list || []).map((g, i) => ({
    ...g,
    at_ms: resolveValue(g.at_ms, seed, "gesture.at", i) ?? 0,
    duration_ms: resolveValue(g.duration_ms, seed, "gesture.duration", i),
    hold_ms: resolveValue(g.hold_ms, seed, "gesture.hold", i),
    return_ms: resolveValue(g.return_ms, seed, "gesture.return", i),
  }));
}

// Where a point on a figure (body coords) is in the world when the figure
// stands at (x, z) in a reaction pose: the same transform the studio gives
// the figure's pivot (push, lift, shiver, lean away, squash).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _qy = new THREE.Quaternion();
export function bodyToWorld(local, pose, x, z, away) {
  const v = new THREE.Vector3(local[0], local[1], local[2]);
  if (!pose) return v.add(new THREE.Vector3(x, 0, z));
  _ax.crossVectors(_UP, away).normalize();
  _q.setFromAxisAngle(_ax, pose.lean);
  // A spin turns the figure about its own vertical axis under the lean.
  if (pose.yaw) _q.multiply(_qy.setFromAxisAngle(_UP, pose.yaw));
  _m.compose(
    new THREE.Vector3(x + away.x * pose.push - away.z * pose.shiver, pose.lift, z + away.z * pose.push + away.x * pose.shiver),
    _q,
    new THREE.Vector3(1, pose.squash, 1),
  );
  return v.applyMatrix4(_m);
}

export function buildStage(template, seed) {
  const space = template.space || {};
  const fp = space.footprint || {};
  const caster = new THREE.Vector3(0, 0, 0);
  const hand = new THREE.Vector3(0.28, 0.68, -0.22);
  const length = resolveValue(fp.length, seed, "footprint.length") ?? 4;
  const scale = resolveValue(space.scale, seed, "space.scale") ?? 1;

  let targets = [];
  // A status effect (archetype "status") afflicts one character: it stands
  // alone at the origin, facing the front camera, with no caster.
  const status = isStatus(template);
  // Splash: one primary target picked by the caster, and more enemies
  // standing around it (engine/splash.js). targets[0] is the primary; the
  // rest are its splash targets (anchor "splash"). Point-blank (centred on
  // the caster): every target is a splash target.
  const splash = isSplash(space);
  let splashOrder = [];
  let splashDelays = [];
  let splashCentered = false;
  let splashCentre = null;
  if (status) {
    targets = [new THREE.Vector3(0, 0, 0)];
  } else if (splash) {
    const lay = splashLayout(space, seed);
    splashCentered = lay.centered;
    // Point-blank: no primary enemy, the caster is the centre. Ground-
    // targeted: no primary enemy, a spot on the ground is.
    if (lay.ground) splashCentre = new THREE.Vector3(lay.primary.x, 0, lay.primary.z);
    else if (!lay.centered) targets.push(new THREE.Vector3(lay.primary.x, 0, lay.primary.z));
    splashOrder = lay.others.map((p) => new THREE.Vector3(p.x, 0, p.z));
    targets.push(...splashOrder);
    splashDelays = lay.delays;
  } else if (space.travel === "chain" || space.destination === "targets") {
    const t = space.targets || {};
    const count = Math.round(resolveValue(t.count, seed, "targets.count") ?? 3);
    const angle = resolveValue(fp.angle_deg, seed, "footprint.angle") ?? 60;
    const r = rng(seedFor(seed, "targets.layout"));
    let dist = 1.8;
    for (let i = 0; i < count; i++) {
      dist += r.range(0.8, 1.6);
      const a = THREE.MathUtils.degToRad(r.range(-angle / 2, angle / 2));
      targets.push(new THREE.Vector3(Math.cos(a) * Math.min(dist, length), 0, Math.sin(a) * Math.min(dist, length)));
    }
    targets.sort((p, q) => p.length() - q.length());
  } else if (space.destination === "target" || space.origin === "sky") {
    targets = [new THREE.Vector3(Math.min(length, 4), 0, 0)];
  }

  const point = new THREE.Vector3(length, hand.y, 0);
  const primaryTarget = splashCentered ? caster.clone() : splashCentre || targets[0] || point.clone().setY(0);
  const sky = primaryTarget.clone().setY(Math.max(3, scale));
  const hop = space.targets?.hop_delay_ms;
  const splashRadius = splash ? splashOrder.reduce((m, p) => Math.max(m, p.distanceTo(primaryTarget)), 0) : 0;
  // Spells centred on the caster (a quake around them) frame the caster.
  const aroundCaster = space.destination === "caster";
  const far = aroundCaster ? 0 : targets.reduce((m, p) => Math.max(m, p.length()), point.x);
  const center = status ? new THREE.Vector3(0, 0.6, 0) : new THREE.Vector3(far / 2, 0.6, 0);
  // An arc footprint (a frontal wave) spreads sideways too: frame its width.
  const arcAngle = fp.shape === "arc" ? Math.min(180, resolveValue(fp.angle_deg, seed, "footprint.angle") ?? 90) : 0;
  const arcHalfWidth = arcAngle ? length * Math.sin(THREE.MathUtils.degToRad(arcAngle / 2)) + 0.7 : 0;
  // A point-blank splash rings the caster with enemies: frame them all.
  const aroundRadius = aroundCaster
    ? Math.max(resolveValue(fp.radius ?? fp.length, seed, "footprint.radius") ?? 3, splashRadius) + (splashCentered ? 2 : 0.8)
    : 0;
  // A splash spreads sideways round the primary target: frame its width too.
  const splashHalfWidth = splash ? targets.reduce((m, p) => Math.max(m, Math.abs(p.z)), 0) + 1 : 0;
  const radius = status ? 1.6 : Math.max(2.2, far / 2 + 1.2, space.origin === "sky" ? sky.y / 1.6 : 0, arcHalfWidth, aroundRadius, splashHalfWidth);

  // Who stands round the caster or the primary target: enemies (default) or
  // allies (a rallying shout, a battle-fury aura). And how the stand-ins
  // react (engine/react.js): space.targets.react for the targets, delayed
  // like their splash layers, and space.caster_react for the caster.
  const side = space.targets?.side === "allies" ? "allies" : "enemies";
  // targets.react: one reaction, or a list (staggered by each hit of a combo).
  const targetReacts = [].concat(space.targets?.react || []).filter(Boolean);
  const targetReact = targetReacts[0] || null;
  // caster_react: one reaction, or a list played together (a lunge, then a spin).
  const casterReacts = [].concat(space.caster_react || []).filter(Boolean);
  const casterReact = casterReacts[0] || null;
  const reactAt = (r, i = 0) => resolveValue(r?.at_ms, seed, i ? `react.at.${i}` : "react.at") ?? 0;
  const casterAts = casterReacts.map((r, i) => reactAt(r, i));
  const targetAts = targetReacts.map((r, i) => reactAt(r, i));
  // A held weapon (space.caster_weapon): the blade rides in the lead hand,
  // and the casting hand rests holding it up in guard.
  const weaponDef = space.caster_weapon || null;
  const weapon = weaponDef
    ? { kind: weaponDef.kind || "sword", length: (resolveValue(weaponDef.length_px, seed, "weapon.length") ?? 0) * PX || undefined }
    : null;
  const casterRest = weapon ? "blade" : "ready";
  const firstSplash = splash && !splashCentered && !splashCentre ? 1 : 0;
  const targetDelay = (i) => {
    const k = i - firstSplash;
    return splash && k >= 0 ? splashDelays[k] ?? 0 : 0;
  };

  // Arms (engine/gesture.js). The caster's gestures come from
  // space.caster_gestures; without any, a shout swings its arms wide. The
  // targets' arms follow their reaction.
  const casterTracks = gestureTracks(
    space.caster_gestures ? resolveGestures(space.caster_gestures, seed) : casterReact ? reactionGestures(casterReact, reactAt(casterReact)) : [],
  );
  const targetTracks = targets.map((_, i) => (targetReact && !status
    ? gestureTracks(targetReacts.flatMap((r, j) => reactionGestures(r, targetAts[j] + targetDelay(i))))
    : null));
  // A Mixamo-style clip (space.caster_clip, engine/rig.js) drives the
  // caster's arms while it plays, blended in from and back out to the
  // gestures. Without the clip loaded, the gestures play as usual.
  const clipDef = !status && space.caster_clip?.clip ? space.caster_clip : null;
  const clip = clipDef ? getClip(clipDef.clip) : null;
  const clipOn = isClip(clip);
  let armsMemo = null;
  const casterPosed = (t) => {
    const tt = Number.isFinite(t) ? t : 0;
    if (!armsMemo || armsMemo.t !== tt) {
      const arms = armsAt(casterTracks, tt, casterRest, weapon || {});
      let rig = null;
      let out = arms;
      if (clipOn) {
        const pb = clipPlayback(clipDef, clip, tt);
        if (pb.weight > 0) {
          rig = blendRig(rigFromArms(arms), sampleClip(clip, pb.ms, { mirror: !!clipDef.mirror }), pb.weight);
          out = armsFromRig(rig);
          out.blade = bladeFK(out.lead, weapon || {});
        }
      }
      armsMemo = { t: tt, arms: out, rig };
    }
    return armsMemo;
  };
  const casterArms = (t) => casterPosed(t).arms;

  return {
    caster,
    hand,
    status,
    side,
    weapon,
    // Target i's pose at time t (its reaction, delayed like its splash
    // layers), and the unit ground direction it is pushed along: away from
    // the spell's centre (from the caster for the primary target).
    targetPose(i, t) {
      if (!targetReact || status) return { ...REST };
      return combinedPose(targetReacts, targetAts, t - targetDelay(i));
    },
    targetAway(i) {
      const p = targets[i];
      if (!p) return new THREE.Vector3(1, 0, 0);
      const from = splash && !(firstSplash && i === 0) ? primaryTarget : caster;
      const d = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
      return d.lengthSq() > 1e-8 ? d.normalize() : new THREE.Vector3(1, 0, 0);
    },
    casterPose(t) {
      if (!casterReact || status) return { ...REST };
      return combinedPose(casterReacts, casterAts, t);
    },
    // Arms in body coords (engine/gesture.js armsAt) for a figure at time t:
    // who is "caster", a target index, or "status" (the afflicted figure).
    armsLocal(who, t) {
      if (who === "caster") return casterArms(t);
      if (who === "status" || status) return armsAt(null, t, "hang");
      return armsAt(targetTracks[who], t, "hang");
    },
    // The caster's skeleton at time t (engine/rig.js), its reaction folded
    // into the hips: what the rig export bakes.
    rigAt(t) {
      const p = casterPosed(t);
      const rig = p.rig || rigFromArms(p.arms);
      return casterReact && !status ? applyRoot(rig, rootOf(this.casterPose(t), [-1, 0, 0])) : rig;
    },
    // The caster's skeleton at time t without its reaction (the studio moves
    // the whole figure for that): what a rigged caster model is posed from.
    casterRig(t) {
      const p = casterPosed(t);
      return p.rig || rigFromArms(p.arms);
    },
    // Whether a clip (space.caster_clip) drives the caster: its name, or null.
    clip: clipOn ? String(clipDef.clip) : null,
    clipMissing: clipDef && !clipOn ? String(clipDef.clip) : null,
    // Where the caster's hand is at time t (world). which: "lead" (the
    // casting hand, caster_hand), "off", "tip" (the lead index fingertip),
    // "off_tip", or "both" (between the palms). Before the effect has a time,
    // the hands are at rest.
    handAt(t = this.now, which = "lead") {
      if (status) return hand.clone();
      const a = casterArms(t);
      const local =
        which === "off" ? a.off.hand
        : which === "tip" ? a.lead.tip
        : which === "off_tip" ? a.off.tip
        : which === "both" ? a.lead.hand.map((v, j) => (v + a.off.hand[j]) / 2)
        : which === "blade" ? a.blade.mid
        : which === "blade_tip" ? a.blade.tip
        : a.lead.hand;
      return bodyToWorld(local, casterReact ? this.casterPose(t ?? 0) : null, 0, 0, new THREE.Vector3(-1, 0, 0));
    },
    // The caster's blade at time t (world): { guard, tip }. Without a
    // caster_weapon, where a sword in the casting hand would be.
    bladeAt(t = this.now) {
      if (status) return { guard: hand.clone(), tip: hand.clone().add(new THREE.Vector3(0.5, 0, 0)) };
      const a = casterArms(t);
      const pose = casterReact ? this.casterPose(t ?? 0) : null;
      const back = new THREE.Vector3(-1, 0, 0);
      return { guard: bodyToWorld(a.blade.guard, pose, 0, 0, back), tip: bodyToWorld(a.blade.tip, pose, 0, 0, back) };
    },
    // The effect's current time (set by Effect.update each frame), so
    // anchors on the hands follow the arms.
    now: 0,
    // The pose of the figure a layer anchored at `anchor` (instance k) stands
    // on, so a skin on a body (a coat) moves with it: { pose, away } or null.
    bodyPose(anchor, k, t) {
      if (status) return null;
      if (anchor === "caster") return casterReact ? { pose: this.casterPose(t), away: new THREE.Vector3(-1, 0, 0) } : null;
      if (!targetReact) return null;
      const i = anchor === "splash" ? k + firstSplash : anchor === "target" && !splash ? k : anchor === "target" && firstSplash ? 0 : -1;
      if (i < 0 || !targets[i]) return null;
      return { pose: this.targetPose(i, t), away: this.targetAway(i) };
    },
    targets,
    point,
    sky,
    scale,
    hopDelay: (k) => k * (resolveValue(hop, seed, "hop", k) ?? 80),
    splash,
    splashCentered,
    splashNoPrimary: splashCentered || !!splashCentre,
    splashFromSky: splash && space.origin === "sky",
    splashTargets: splashOrder,
    splashRadius,
    splashDelay: (k) => splashDelays[k] ?? 0,
    // Where a splash layer (instance k) comes from: the primary target, the
    // splash target before it (the primary for the first; with wrap, the
    // last), or the sky above it.
    splashFrom(k, from = "primary", wrap = false, height = 0.55) {
      const n = splashOrder.length;
      if (from === "sky") return (splashOrder[k] || primaryTarget).clone().setY(Math.max(3, scale));
      if (from === "previous") {
        const prev = k > 0 ? splashOrder[k - 1] : wrap && n > 1 ? splashOrder[n - 1] : primaryTarget;
        return prev.clone().setY(height);
      }
      return primaryTarget.clone().setY(height);
    },
    center,
    radius,
    close: template.views?.frame === "close",
    showPointMarker: space.destination === "point",
    anchor(name, k = 0, t = this.now) {
      switch (name) {
        case "caster":
          return caster.clone();
        case "caster_hand":
          return this.handAt(t, "lead");
        case "caster_off_hand":
          return this.handAt(t, "off");
        case "caster_fingertip":
          return this.handAt(t, "tip");
        case "caster_off_fingertip":
          return this.handAt(t, "off_tip");
        case "caster_hands":
          return this.handAt(t, "both");
        case "caster_blade":
          return this.handAt(t, "blade");
        case "caster_blade_tip":
          return this.handAt(t, "blade_tip");
        case "sky":
          return sky.clone();
        case "ground":
        case "target":
          return (splash ? primaryTarget : targets[k] || primaryTarget).clone();
        case "splash":
          return (splashOrder[k] || primaryTarget).clone();
        case "point":
          return space.travel === "beam" ? point.clone() : (targets[k] || point).clone();
        default:
          return primaryTarget.clone();
      }
    },
    // Chest height on a target, where arcs land.
    chest(k = 0) {
      if (splashCentre && k === 0) return primaryTarget.clone().setY(0.55);
      return (targets[k] || primaryTarget).clone().setY(0.55);
    },
    // Chest height on splash target k.
    splashChest(k = 0) {
      return (splashOrder[k] || primaryTarget).clone().setY(0.55);
    },
  };
}

// Camera presets for the four standard views, framed on the stage.
export function viewCamera(view, stage, aspect) {
  const c = stage.center.clone();
  const tall = Math.min(stage.sky.y, 6);
  // Sky strikes frame their height too; so do splash spells dropped from the sky.
  const strike = !stage.status && tall > 2.5 && (stage.targets.length <= 1 || stage.splashFromSky);
  // Frame the whole effect: its width (caster to furthest target) and, for
  // sky strikes, its height.
  // views.frame "close": a small effect on one character (a buff) fills the
  // frame: head to toe plus what floats just above the head.
  const close = !!stage.close;
  const halfH = close ? 1.3 : Math.max(stage.radius * 0.62, strike ? tall * 0.62 : 1.3);
  // A status effect frames the afflicted character with room above its
  // head (stars, Zs, skulls float there).
  const lookY = close ? 0.8 : strike ? tall * 0.42 : stage.status ? 0.72 : 0.55;
  const fov = 38;
  const dist = (halfH / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.1;

  if (view === "top") {
    // Orthographic plan view: vertical things collapse to points, footprints read true.
    const h = close || stage.status ? 1.25 : Math.max(stage.radius * 0.75, 1.6);
    const cam = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, 200);
    cam.userData.halfH = h;
    cam.position.set(c.x, 40, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(c.x, 0, 0);
    cam.userData.look = new THREE.Vector3(c.x, 0, 0);
    return cam;
  }

  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 200);
  const look = new THREE.Vector3(c.x, lookY, 0);
  switch (view) {
    case "front": {
      // Over the caster's shoulder, looking down the cast direction.
      // Behind the caster; with enemies all round a point-blank caster,
      // step back and up past the ring so none stands in front of the lens.
      // A status effect: face to face with the afflicted character.
      const back = stage.status ? 3.3 : close ? 3.4 : stage.splashCentered ? stage.splashRadius + 3.2 : Math.max(2.4, dist * 0.45);
      cam.position.set(-back, stage.status ? 1.15 : close ? 1.05 : stage.splashCentered ? 3 : 1.25, stage.status ? 0 : 0.55);
      look.set(c.x * 2, lookY, 0);
      cam.lookAt(look);
      break;
    }
    case "side":
      cam.position.set(c.x, lookY + 0.15, dist);
      cam.lookAt(look);
      break;
    case "three_quarter":
    default: {
      // 45 degrees around from behind the caster, 35 degrees down.
      const yaw = THREE.MathUtils.degToRad(45);
      const pitch = THREE.MathUtils.degToRad(35);
      const r = dist * (strike && !close ? 1.3 : 1.05);
      cam.position.set(
        look.x - Math.sin(yaw) * Math.cos(pitch) * r * 0.55,
        look.y + Math.sin(pitch) * r,
        look.z + Math.cos(yaw) * Math.cos(pitch) * r,
      );
      cam.lookAt(look);
      break;
    }
  }
  cam.userData.look = look;
  return cam;
}

export const VIEWS = ["front", "side", "top", "three_quarter"];
export const VIEW_LABELS = { front: "Front", side: "Side", top: "Top", three_quarter: "3/4" };
