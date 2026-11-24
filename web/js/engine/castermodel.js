// A real character as the caster: a rigged model with a Mixamo-named
// skeleton (a Mixamo character downloaded as FBX, or a GLB), posed every
// frame from the caster's rig (engine/rig.js) in place of the stand-in's
// body and arms. The held weapon is still drawn by the studio, from the
// gestures, so every hand and blade anchor stays where the effects expect.
//
// Retargeting is the inverse of web/js/clipimport.js: each bone's world
// rotation is the rig's change from the T-pose (turned into the model's
// frame) applied to the model's own bind pose (a T-pose for Mixamo
// characters). The model is scaled to the stand-in's height and turned to
// face +X. Proportions need not match, only the T-pose.
//
// A pure function of the rig pose: pose(rig) sets every bone fresh.

import * as THREE from "three";
import { FBXLoader } from "../../vendor/loaders/FBXLoader.js";
import { GLTFLoader } from "../../vendor/loaders/GLTFLoader.js";
import { REST, WEAPON_BONE, canonicalBone } from "./rig.js";

const NEEDED = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];

async function parse(buffer, fileName) {
  const ext = (String(fileName).match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
  if (ext === "fbx") return new FBXLoader().parse(buffer, "");
  if (ext === "glb" || ext === "gltf") return (await new GLTFLoader().parseAsync(buffer, "")).scene;
  throw new Error("A caster model is an .fbx, .glb or .gltf file with a Mixamo-named skeleton.");
}

/**
 * Load a rigged character. buffer: its bytes; fileName: for the format.
 * Returns { object, pose(rig), name, dispose() }: add object to a figure
 * (1 unit tall, facing +X, feet at the origin) and call pose(rig) each frame.
 */
export async function loadCasterModel(buffer, fileName, opts = {}) {
  const root = await parse(buffer, fileName);
  root.animations = [];
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);

  // The skeleton's bones in parent-first order (traverse visits parents first).
  const bones = [];
  const byName = {};
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton?.pose();
      o.frustumCulled = false; // the posed body leaves its bind-pose bounds
      o.castShadow = false;
    }
  });
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const b = canonicalBone(o.name);
    if (o.isBone || (b && !o.isMesh)) {
      bones.push(o);
      if (b && b !== WEAPON_BONE && !byName[b]) byName[b] = o;
    }
  });
  const missing = NEEDED.filter((b) => !byName[b]);
  if (missing.length) throw new Error(`Not a Mixamo-style skeleton: no ${missing.join(", ")} bone.`);
  const boneSet = new Set(bones);

  // Rest (bind) pose, in the model's own space.
  const rest = new Map();
  for (const o of bones) {
    const parentIsBone = boneSet.has(o.parent);
    rest.set(o, {
      bone: canonicalBone(o.name),
      local: o.quaternion.clone(),
      pos: o.position.clone(),
      world: o.getWorldQuaternion(new THREE.Quaternion()),
      // A bone whose parent is not a bone hangs off a fixed transform.
      parentWorld: parentIsBone ? null : o.parent.getWorldQuaternion(new THREE.Quaternion()),
      parentInv: parentIsBone ? null : new THREE.Matrix3().setFromMatrix4(o.parent.matrixWorld).invert(),
    });
  }
  const P = (b) => byName[b].getWorldPosition(new THREE.Vector3());

  // The model's frame (left, up, forward) and the turn to ours (+X forward,
  // +Y up, -Z left), as clipimport.js works it out.
  const left = P("LeftArm").sub(P("RightArm")).normalize();
  const up = P("Head").sub(P("Hips"));
  up.addScaledVector(left, -up.dot(left)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const src = new THREE.Matrix4().makeBasis(fwd, up, left);
  const ours = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const C = ours.multiply(src.clone().transpose());
  const qC = new THREE.Quaternion().setFromRotationMatrix(C);
  const qCi = qC.clone().invert();

  // Height: the lowest point of the skin (or the feet) to the top of the head.
  root.traverse((o) => o.isSkinnedMesh && o.geometry.computeBoundingBox());
  const box = new THREE.Box3().setFromObject(root);
  const along = (sign) => {
    let best = sign * -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).dot(up);
      best = sign > 0 ? Math.max(best, c) : Math.min(best, c);
    }
    return best;
  };
  const feet = ["LeftToe_End", "RightToe_End", "LeftFoot", "RightFoot"].filter((b) => byName[b]).map((b) => P(b).dot(up));
  const floor = box.isEmpty() ? Math.min(...feet) : along(-1);
  const top = byName.HeadTop_End ? P("HeadTop_End").dot(up) : along(1);
  const height = Math.max(1e-6, top - floor);
  const s = REST.pos.HeadTop_End[1] / height;

  // The wrapper: the model turned to face +X, scaled to the stand-in's
  // height and stood on the ground under its hips.
  const object = new THREE.Group();
  object.name = "caster-model";
  const hips = P("Hips").applyMatrix4(C).multiplyScalar(s);
  object.quaternion.copy(qC);
  object.scale.setScalar(s);
  object.position.set(-hips.x, -floor * s, -hips.z);
  object.add(root);
  if (opts.tint) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (m?.color) m.color.lerp(new THREE.Color(opts.tint), 0.25);
    });
  }

  const _worldQ = new Map();
  const _dq = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();

  /** Pose the model from a rig pose ({ rot, hips }, engine/rig.js). Null: the bind pose. */
  function pose(rig) {
    _worldQ.clear();
    for (const o of bones) {
      const r = rest.get(o);
      const pq = r.parentWorld || _worldQ.get(o.parent);
      const d = rig?.rot?.[r.bone];
      const want = new THREE.Quaternion();
      if (d && r.bone !== WEAPON_BONE) {
        // The rig's change from rest, turned into the model's frame.
        _dq.set(d[0], d[1], d[2], d[3]);
        want.copy(qCi).multiply(_dq).multiply(qC).multiply(r.world);
      } else {
        want.copy(pq).multiply(r.local);
      }
      o.quaternion.copy(_q.copy(pq).invert().multiply(want));
      _worldQ.set(o, want);
      if (r.bone === "Hips") {
        o.position.copy(r.pos);
        if (rig?.hips && r.parentInv) {
          // The hips' travel (figure units, our frame) into the parent's space.
          _v.fromArray(rig.hips).applyMatrix4(new THREE.Matrix4().copy(C).invert()).multiplyScalar(1 / s);
          o.position.add(_v.applyMatrix3(r.parentInv));
        }
      }
    }
  }
  pose(null);

  return {
    object,
    pose,
    name: opts.name || String(fileName).replace(/\.[^.]+$/, ""),
    dispose() {
      object.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); });
      });
    },
  };
}
