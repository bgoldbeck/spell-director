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
  function setStage(stage) {
    disposeTree(props);
    props.clear();
    props.add(standIn("#8c90a0", 1));
    for (const p of stage.targets) {
      const d = standIn("#6c6f7b", -1);
      d.position.set(p.x, 0, p.z);
      d.lookAt(0, 0, 0);
      d.rotateY(-Math.PI / 2);
      props.add(d);
    }
    if (stage.showPointMarker) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32), new THREE.MeshBasicMaterial({ color: "#555b6e" }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(stage.point.x, 0.01, 0);
      props.add(m);
    }
  }

  return {
    scene,
    props,
    setStage,
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
