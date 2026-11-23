// Turn a Mixamo animation (FBX or GLB/glTF, any Mixamo-named skeleton) into
// a "spelldirector.clip/1" clip (engine/rig.js), once, in the browser. The
// clip is saved in the library's clips/ folder and a template plays it on the
// caster with space.caster_clip.
//
// Retargeting: each bone's world rotation is taken as a change from the
// source's bind pose (a T-pose for Mixamo characters), turned into
// SpellDirector's frame (the source's facing and up are worked out from its
// skeleton), and applied to the caster's own T-pose. The hips move scaled by
// leg length. So proportions don't need to match, only the T-pose.

import * as THREE from "three";
import { FBXLoader } from "../vendor/loaders/FBXLoader.js";
import { GLTFLoader } from "../vendor/loaders/GLTFLoader.js";
import { BONE_NAMES, REST, WEAPON_BONE, canonicalBone, makeClip } from "./engine/rig.js";

const NEEDED = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];

/** A clip name from a file name: "Standing 2H Magic Attack 01.fbx" -> "standing-2h-magic-attack-01". */
export function clipNameFor(fileName) {
  return (
    String(fileName || "clip")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "clip"
  );
}

async function load(buffer, fileName) {
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
  if (ext === "fbx") {
    const root = new FBXLoader().parse(buffer, "");
    return { root, animations: root.animations || [] };
  }
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    return { root: gltf.scene, animations: gltf.animations || [] };
  }
  throw new Error("Pick an .fbx, .glb or .gltf file (Mixamo: Download, Format FBX Binary).");
}

/**
 * Convert an animation file to a clip. buffer: its bytes (ArrayBuffer).
 * opts: { fps (default 30), name, animation (index, default the longest) }.
 * Returns { clip, name, info: { bones, missing, frames, seconds, source } }.
 */
export async function clipFromFile(buffer, fileName, opts = {}) {
  const fps = Math.max(5, Math.min(120, Number(opts.fps) || 30));
  const { root, animations } = await load(buffer, fileName);
  if (!animations.length) throw new Error("That file has no animation in it.");
  const anim = Number.isInteger(opts.animation) && animations[opts.animation]
    ? animations[opts.animation]
    : animations.reduce((a, b) => (b.duration > a.duration ? b : a));

  // Our bones, found by name (the first match wins: a Mixamo file has one skeleton).
  const bones = {};
  let mixamo = false;
  root.traverse((o) => {
    if (/mixamorig/i.test(o.name)) mixamo = true;
    const b = canonicalBone(o.name);
    if (b && b !== WEAPON_BONE && !bones[b] && (o.isBone || o.type === "Object3D" || o.isObject3D)) bones[b] = o;
  });
  const missing = NEEDED.filter((b) => !bones[b]);
  if (missing.length) throw new Error(`Not a Mixamo-style skeleton: no ${missing.join(", ")} bone. Bones need Mixamo names (mixamorig:Hips, mixamorig:LeftArm...).`);

  // The rest pose: the skin's bind pose (a T-pose for Mixamo characters).
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.pose();
  });
  root.updateMatrixWorld(true);
  const restQ = {};
  const restP = {};
  for (const [b, o] of Object.entries(bones)) {
    restQ[b] = o.getWorldQuaternion(new THREE.Quaternion());
    restP[b] = o.getWorldPosition(new THREE.Vector3());
  }

  // The source's frame: its left (right shoulder to left), up (hips to head)
  // and forward; and the turn that takes it to ours (+X forward, +Y up, -Z left).
  const left = restP.LeftArm.clone().sub(restP.RightArm).normalize();
  const up = restP.Head.clone().sub(restP.Hips);
  up.addScaledVector(left, -up.dot(left)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const src = new THREE.Matrix4().makeBasis(fwd, up, left);
  const ours = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  const C = ours.multiply(src.clone().transpose());
  const qC = new THREE.Quaternion().setFromRotationMatrix(C);
  const qCi = qC.clone().invert();

  // Scale the hips' travel by leg length (hips height above the ankles).
  const feet = bones.LeftFoot && bones.RightFoot ? restP.LeftFoot.clone().add(restP.RightFoot).multiplyScalar(0.5) : null;
  const srcLeg = feet ? restP.Hips.clone().sub(feet).dot(up) : restP.Head.clone().sub(restP.Hips).length() * 1.6;
  const ourLeg = REST.pos.Hips[1] - REST.pos.LeftFoot[1];
  const k = srcLeg > 1e-6 ? ourLeg / srcLeg : 1;

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(anim);
  action.play();
  const count = Math.max(2, Math.floor(anim.duration * fps + 1e-6) + 1);
  const frames = [];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    mixer.setTime(Math.min(anim.duration, i / fps));
    root.updateMatrixWorld(true);
    const rot = {};
    for (const [b, o] of Object.entries(bones)) {
      o.getWorldQuaternion(q);
      // The change from rest in the source's world, turned into our frame.
      const d = q.clone().multiply(restQ[b].clone().invert());
      const dq = qC.clone().multiply(d).multiply(qCi);
      rot[b] = [dq.x, dq.y, dq.z, dq.w];
    }
    bones.Hips.getWorldPosition(p);
    const off = p.clone().sub(restP.Hips).applyMatrix4(C).multiplyScalar(k);
    frames.push({ rot, hips: [off.x, off.y, off.z] });
  }
  mixer.stopAllAction();
  const name = opts.name || clipNameFor(fileName);
  const clip = makeClip(frames, fps, { name, source: mixamo ? `mixamo: ${fileName}` : fileName });
  // Keep what the file's T-pose looked like next to ours, as a sanity check.
  const armDir = restP.LeftForeArm.clone().sub(restP.LeftArm).normalize().applyMatrix4(C);
  clip.rest_check = { left_upper_arm_dir: [armDir.x, armDir.y, armDir.z].map((v) => Math.round(v * 1000) / 1000), t_pose: Math.abs(armDir.y) < 0.5 };
  return {
    clip,
    name,
    info: { bones: Object.keys(bones).length, missing: BONE_NAMES.filter((b) => !bones[b]), frames: count, seconds: anim.duration, source: anim.name, tPose: clip.rest_check.t_pose },
  };
}
