// Where things are in the 3D scene. One unit = one character height.
// The caster stands at the origin facing +X.

import * as THREE from "three";
import { resolveValue, rng, seedFor } from "./timeline.js";
import { isSplash, splashLayout } from "./splash.js";

export const PX = 0.01; // template pixel sizes -> world units

export function buildStage(template, seed) {
  const space = template.space || {};
  const fp = space.footprint || {};
  const caster = new THREE.Vector3(0, 0, 0);
  const hand = new THREE.Vector3(0.28, 0.68, -0.22);
  const length = resolveValue(fp.length, seed, "footprint.length") ?? 4;
  const scale = resolveValue(space.scale, seed, "space.scale") ?? 1;

  let targets = [];
  // Splash: one primary target picked by the caster, and more enemies
  // standing around it (engine/splash.js). targets[0] is the primary; the
  // rest are its splash targets (anchor "splash").
  const splash = isSplash(space);
  let splashOrder = [];
  let splashDelays = [];
  if (splash) {
    const lay = splashLayout(space, seed);
    targets.push(new THREE.Vector3(lay.primary.x, 0, lay.primary.z));
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
  const primaryTarget = targets[0] || point.clone().setY(0);
  const sky = primaryTarget.clone().setY(Math.max(3, scale));
  const hop = space.targets?.hop_delay_ms;
  const splashRadius = splash ? splashOrder.reduce((m, p) => Math.max(m, p.distanceTo(targets[0])), 0) : 0;
  // Spells centred on the caster (a quake around them) frame the caster.
  const aroundCaster = space.destination === "caster";
  const far = aroundCaster ? 0 : targets.reduce((m, p) => Math.max(m, p.length()), point.x);
  const center = new THREE.Vector3(far / 2, 0.6, 0);
  // An arc footprint (a frontal wave) spreads sideways too: frame its width.
  const arcAngle = fp.shape === "arc" ? Math.min(180, resolveValue(fp.angle_deg, seed, "footprint.angle") ?? 90) : 0;
  const arcHalfWidth = arcAngle ? length * Math.sin(THREE.MathUtils.degToRad(arcAngle / 2)) + 0.7 : 0;
  const aroundRadius = aroundCaster ? (resolveValue(fp.radius ?? fp.length, seed, "footprint.radius") ?? 3) + 0.8 : 0;
  // A splash spreads sideways round the primary target: frame its width too.
  const splashHalfWidth = splash ? targets.reduce((m, p) => Math.max(m, Math.abs(p.z)), 0) + 1 : 0;
  const radius = Math.max(2.2, far / 2 + 1.2, space.origin === "sky" ? sky.y / 1.6 : 0, arcHalfWidth, aroundRadius, splashHalfWidth);

  return {
    caster,
    hand,
    targets,
    point,
    sky,
    scale,
    hopDelay: (k) => k * (resolveValue(hop, seed, "hop", k) ?? 80),
    splash,
    splashFromSky: splash && space.origin === "sky",
    splashTargets: splashOrder,
    splashRadius,
    splashDelay: (k) => splashDelays[k] ?? 0,
    // Where a splash layer (instance k) comes from: the primary target, the
    // splash target before it (the primary for the first; with wrap, the
    // last), or the sky above it.
    splashFrom(k, from = "primary", wrap = false, height = 0.55) {
      const n = splashOrder.length;
      if (from === "sky") return (splashOrder[k] || targets[0]).clone().setY(Math.max(3, scale));
      if (from === "previous") {
        const prev = k > 0 ? splashOrder[k - 1] : wrap && n > 1 ? splashOrder[n - 1] : targets[0];
        return prev.clone().setY(height);
      }
      return targets[0].clone().setY(height);
    },
    center,
    radius,
    close: template.views?.frame === "close",
    showPointMarker: space.destination === "point",
    anchor(name, k = 0) {
      switch (name) {
        case "caster":
          return caster.clone();
        case "caster_hand":
          return hand.clone();
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
  const strike = tall > 2.5 && (stage.targets.length <= 1 || stage.splashFromSky);
  // Frame the whole effect: its width (caster to furthest target) and, for
  // sky strikes, its height.
  // views.frame "close": a small effect on one character (a buff) fills the
  // frame: head to toe plus what floats just above the head.
  const close = !!stage.close;
  const halfH = close ? 1.3 : Math.max(stage.radius * 0.62, strike ? tall * 0.62 : 1.3);
  const lookY = close ? 0.8 : strike ? tall * 0.42 : 0.55;
  const fov = 38;
  const dist = (halfH / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 1.1;

  if (view === "top") {
    // Orthographic plan view: vertical things collapse to points, footprints read true.
    const h = close ? 1.25 : Math.max(stage.radius * 0.75, 1.6);
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
      const back = close ? 3.4 : Math.max(2.4, dist * 0.45);
      cam.position.set(-back, close ? 1.05 : 1.25, 0.55);
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
