// The viewer's set: dark background, lights, a ground disc with a grid, and
// simple stand-in figures for the caster and targets. Shared by the viewer and
// the GIF export, so a GIF looks like the view on screen.

import * as THREE from "three";

export const STUDIO_BACKGROUND = "#0b0d12";

function standIn(color, facing = 1) {
  // A simple figure, 1 unit tall, like the stand-ins in a motion study.
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 4, 12), mat);
  body.position.y = 0.37;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
  head.position.y = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.2), new THREE.MeshStandardMaterial({ color: "#2a2d36" }));
  visor.position.set(0.12 * facing, 0.88, 0);
  g.add(body, head, visor);
  return g;
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
      props.add(standIn("#7a7e8c", -1));
      return;
    }
    posed.push({ g: pivot(standIn("#8c90a0", 1), 0, 0, new THREE.Vector3(-1, 0, 0)), caster: true });
    // Allies (a rallying shout, a battle-fury aura) wear a blue tint and a
    // green ring at their feet; enemies stay grey.
    const allies = stage.side === "allies";
    stage.targets.forEach((p, i) => {
      const d = standIn(allies ? "#6f86b0" : "#6c6f7b", -1);
      d.lookAt(-p.x, 0, -p.z);
      d.rotateY(-Math.PI / 2);
      const g = pivot(d, p.x, p.z, stage.targetAway ? stage.targetAway(i) : new THREE.Vector3(1, 0, 0));
      posed.push({ g, i });
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
    for (const { g, i, caster } of posed) {
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
