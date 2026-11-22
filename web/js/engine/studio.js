// The viewer's set: dark background, lights, a ground disc with a grid, and
// simple stand-in figures for the caster and targets. Shared by the viewer and
// the GIF export, so a GIF looks like the view on screen.

import * as THREE from "three";
import { BODY } from "./gesture.js";

export const STUDIO_BACKGROUND = "#0b0d12";

// Crude low-poly arms: a capsule-ish upper arm and forearm, ball joints, a
// box palm and two-segment fingers, all placed fresh each frame from the
// joint positions engine/gesture.js works out (so the hand anchors the
// effects use sit exactly on the hands drawn here).
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function placeSegment(mesh, a, b) {
  _a.fromArray(a);
  _b.fromArray(b);
  _d.subVectors(_b, _a);
  const l = _d.length();
  mesh.position.addVectors(_a, _b).multiplyScalar(0.5);
  if (l > 1e-6) mesh.quaternion.setFromUnitVectors(Y, _d.multiplyScalar(1 / l));
  mesh.scale.set(1, Math.max(1e-4, l), 1);
}

function makeArm(mat, skin) {
  const g = new THREE.Group();
  const seg = (r0, r1, m = mat) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 7, 1), m);
  const ball = (r, m = mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
  const parts = {
    upper: seg(0.048, 0.042),
    fore: seg(0.04, 0.032),
    shoulder: ball(0.052),
    elbow: ball(0.041),
    wrist: ball(0.034, skin),
    palm: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skin),
    fingers: Array.from({ length: 5 }, (_, i) => [seg(i ? 0.0145 : 0.016, i ? 0.013 : 0.015, skin), seg(0.013, 0.011, skin)]),
    knuckles: Array.from({ length: 5 }, () => ball(0.014, skin)),
  };
  g.add(parts.upper, parts.fore, parts.shoulder, parts.elbow, parts.wrist, parts.palm, ...parts.fingers.flat(), ...parts.knuckles);
  g.userData.parts = parts;
  return g;
}

function poseArm(arm, fk) {
  const p = arm.userData.parts;
  placeSegment(p.upper, fk.shoulder, fk.elbow);
  placeSegment(p.fore, fk.elbow, fk.wrist);
  p.shoulder.position.fromArray(fk.shoulder);
  p.elbow.position.fromArray(fk.elbow);
  p.wrist.position.fromArray(fk.wrist);
  const { center, aim, normal } = fk.palm;
  // A right-handed basis (the box is symmetric, so the thumb side needn't match).
  _x.fromArray(aim);
  _y.fromArray(normal);
  _basis.makeBasis(_x, _y, _z.crossVectors(_x, _y));
  p.palm.quaternion.setFromRotationMatrix(_basis);
  p.palm.position.fromArray(center);
  p.palm.scale.set(BODY.palmLen, BODY.palmThick, BODY.palmWidth);
  fk.fingers.forEach(([base, mid, tip], i) => {
    placeSegment(p.fingers[i][0], base, mid);
    placeSegment(p.fingers[i][1], mid, tip);
    p.knuckles[i].position.fromArray(mid);
  });
}

function standIn(color, facing = 1) {
  // A simple figure, 1 unit tall, like the stand-ins in a motion study,
  // with crude arms and hands (posed by setArms).
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color("#e6cfb0"), 0.55), roughness: 0.75 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 4, 12), mat);
  body.position.y = 0.37;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
  head.position.y = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.2), new THREE.MeshStandardMaterial({ color: "#2a2d36" }));
  visor.position.set(0.12 * facing, 0.88, 0);
  g.add(body, head, visor);
  // The arms are worked out facing +X; a figure facing -X turns them round.
  const rig = new THREE.Group();
  if (facing < 0) rig.rotation.y = Math.PI;
  const lead = makeArm(mat, skin);
  const off = makeArm(mat, skin);
  rig.add(lead, off);
  g.add(rig);
  g.userData.arms = { lead, off };
  return g;
}

// Pose a stand-in's arms from engine/gesture.js armsAt (body coords).
function setArms(figure, arms) {
  const a = figure?.userData.arms;
  if (!a || !arms) return;
  poseArm(a.lead, arms.lead);
  poseArm(a.off, arms.off);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}

/** {scene, props, setStage(stage), dispose()} */
export function makeStudio() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO_BACKGROUND);
  scene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
  const key = new THREE.DirectionalLight("#cfd6ff", 0.5);
  key.position.set(-3, 6, 4);
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.MeshStandardMaterial({ color: "#5d6478", roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(28, 28, "#3a3f4e", "#333846");
  grid.position.y = 0.002;
  scene.add(grid);

  const props = new THREE.Group();
  scene.add(props);

  // Stand-ins for the caster and each target, and a marker on a ground point.
  // Each figure stands in a pivot at its feet, so update(t) can lean, push,
  // lift and crouch it for a reaction (engine/react.js) without state.
  let posed = [];
  let current = null;
  const pivot = (figure, x, z, away) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(figure);
    g.userData = { x, z, away };
    props.add(g);
    return g;
  };
  function setStage(stage) {
    disposeTree(props);
    props.clear();
    posed = [];
    current = stage;
    // A status effect has no caster: the afflicted character stands alone at
    // the origin, facing the front camera (-X).
    if (stage.status) {
      const f = standIn("#7a7e8c", -1);
      setArms(f, stage.armsLocal?.("status", 0));
      props.add(f);
      return;
    }
    const casterFig = standIn("#8c90a0", 1);
    posed.push({ g: pivot(casterFig, 0, 0, new THREE.Vector3(-1, 0, 0)), caster: true, fig: casterFig });
    // Allies (a rallying shout, a battle-fury aura) wear a blue tint and a
    // green ring at their feet; enemies stay grey.
    const allies = stage.side === "allies";
    stage.targets.forEach((p, i) => {
      const d = standIn(allies ? "#6f86b0" : "#6c6f7b", -1);
      d.lookAt(-p.x, 0, -p.z);
      d.rotateY(-Math.PI / 2);
      const g = pivot(d, p.x, p.z, stage.targetAway ? stage.targetAway(i) : new THREE.Vector3(1, 0, 0));
      posed.push({ g, i, fig: d });
      if (allies) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.31, 40), new THREE.MeshBasicMaterial({ color: "#3f9f6e" }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.008;
        g.add(m);
      }
    });
    // Splash spells: a selection ring under the primary target (the one the
    // caster picked) so it reads apart from the enemies around it.
    if (stage.splash && !stage.splashNoPrimary && stage.targets[0]) {
      const p = stage.targets[0];
      const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40), new THREE.MeshBasicMaterial({ color: "#b04a4a" }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, 0.008, p.z);
      props.add(m);
    }
    if (stage.showPointMarker) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32), new THREE.MeshBasicMaterial({ color: "#555b6e" }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(stage.point.x, 0.01, 0);
      props.add(m);
    }
    update(0);
  }

  // Pose the figures at time t (ms): pushed away from the spell's centre,
  // lifted, crouched and leaning, all worked out fresh from t.
  const axis = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function update(t) {
    if (!current) return;
    for (const { g, i, caster, fig } of posed) {
      setArms(fig, current.armsLocal?.(caster ? "caster" : i, t));
      const pose = caster ? current.casterPose?.(t) : current.targetPose?.(i, t);
      if (!pose) continue;
      const { x, z, away } = g.userData;
      // Sideways is the away direction turned a quarter turn.
      g.position.set(x + away.x * pose.push - away.z * pose.shiver, pose.lift, z + away.z * pose.push + away.x * pose.shiver);
      // Tip the top away from the centre: turn about the horizontal axis
      // at right angles to the away direction.
      axis.crossVectors(UP, away).normalize();
      g.quaternion.setFromAxisAngle(axis, pose.lean);
      g.scale.set(1, pose.squash, 1);
    }
  }  return {
    scene,
    props,
    setStage,
    update,
    dispose() {
      scene.remove(props);
      disposeTree(scene);
    },
  };
}

// The strongest additive screen flash and the strongest darkening at this
// moment (from effect.screen), with the viewer's opacity caps.
export function screenOverlays(effect) {
  let add = null;
  let dark = null;
  for (const s of effect.screen) {
    if (s.dark) dark = !dark || s.opacity > dark.opacity ? s : dark;
    else add = !add || s.opacity > add.opacity ? s : add;
  }
  return {
    flash: add ? { color: `#${add.color.getHexString()}`, opacity: Math.min(0.9, add.opacity) } : null,
    dim: dark ? { color: `#${dark.color.getHexString()}`, opacity: Math.min(0.85, dark.opacity) } : null,
  };
}

// Camera shake: offset the camera for this frame only. Returns an undo.
export function shakeCamera(cam, shake) {
  const saved = cam.position.clone();
  if (shake.x || shake.y) {
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, shake.x).addScaledVector(up, shake.y);
  }
  return () => cam.position.copy(saved);
}

// Quadrant viewports for the four-view layout (bottom-left origin, like gl.viewport).
export function quadViewports(W, H) {
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  return {
    front: { x: 0, y: hh, w: hw, h: H - hh },
    side: { x: hw, y: hh, w: W - hw, h: H - hh },
    top: { x: 0, y: 0, w: hw, h: hh },
    three_quarter: { x: hw, y: 0, w: W - hw, h: hh },
  };
}
