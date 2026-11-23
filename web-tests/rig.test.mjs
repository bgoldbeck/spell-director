// The caster's Mixamo-style skeleton (engine/rig.js) and the rig export
// (engine/rigexport.js, engine/glb.js): gestures turn into bone rotations
// and back without losing a millimetre, clips play back what was baked,
// mirroring swaps the hands, and the GLB and timeline hold together.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GESTURE_KINDS, armsAt, gestureTracks } from "../web/js/engine/gesture.js";
import {
  ALL_BONES,
  BONE_NAMES,
  PARENT,
  QI,
  REST,
  applyRoot,
  armsFromRig,
  canonicalBone,
  clipPlayback,
  makeClip,
  mixamoName,
  qconj,
  qmul,
  rigFromArms,
  rigPositions,
  rootOf,
  sampleClip,
} from "../web/js/engine/rig.js";
import { readGlb } from "../web/js/engine/glb.js";
import { buildTimeline, casterGlb, rigExportFiles, socketsAt, socketDefs, toGltf, toGltfQ } from "../web/js/engine/rigexport.js";
import { clipsWanted, getClip, registerClip } from "../web/js/engine/clips.js";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const schema = JSON.parse(readFileSync(new URL("../schemas/template-0.1.0.schema.json", import.meta.url), "utf8"));

// Every arm point armsAt gives, for comparing two arms.
function points(arms) {
  const out = [];
  for (const s of ["lead", "off"]) {
    const a = arms[s];
    out.push(a.shoulder, a.elbow, a.wrist, a.hand, a.tip, a.palm.center, ...a.fingers.flat());
  }
  return out;
}

const HUMANOID = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
  ...["Left", "Right"].flatMap((s) => ["Thumb", "Index", "Middle", "Ring", "Pinky"].flatMap((f) => [1, 2, 3, 4].map((k) => `${s}Hand${f}${k}`))),
];

test("the skeleton has Mixamo's bones, names and hierarchy", () => {
  for (const b of HUMANOID) assert.ok(BONE_NAMES.includes(b), b);
  assert.equal(PARENT.LeftArm, "LeftShoulder");
  assert.equal(PARENT.LeftHandIndex1, "LeftHand");
  assert.equal(PARENT.LeftHandIndex4, "LeftHandIndex3");
  assert.equal(PARENT.LeftUpLeg, "Hips");
  assert.equal(mixamoName("LeftHand"), "mixamorig:LeftHand");
  // Parents come before their children.
  BONE_NAMES.forEach((b, i) => PARENT[b] && assert.ok(BONE_NAMES.indexOf(PARENT[b]) < i, b));
  for (const n of ["mixamorig:LeftHand", "mixamorigLeftHand", "mixamorig1:LeftHand", "Armature|mixamorig:LeftHand", "LeftHand", "lefthand"]) {
    assert.equal(canonicalBone(n), "LeftHand", n);
  }
  assert.equal(canonicalBone("Camera"), null);
});

test("the rest skeleton is a T-pose with the casting (lead) arm on the left, -Z", () => {
  const p = REST.pos;
  assert.ok(p.LeftHand[2] < -0.5 && p.RightHand[2] > 0.5);
  assert.ok(Math.abs(p.LeftHand[1] - p.LeftArm[1]) < 1e-9, "arm level");
  assert.ok(p.Head[1] > p.Neck[1] && p.Neck[1] > p.Spine2[1] && p.Spine2[1] > p.Hips[1]);
  assert.ok(p.LeftFoot[1] < 0.1 && p.LeftToeBase[0] > 0, "toes point forward (+X)");
  // Thumbs forward, fingers out along the arm.
  assert.ok(p.LeftHandThumb4[0] > p.LeftHandPinky4[0]);
  assert.ok(p.LeftHandMiddle4[2] < p.LeftHand[2]);
});

test("every gesture turns into bone rotations and back exactly", () => {
  for (const kind of GESTURE_KINDS) {
    for (const t of [0, 120, 350, 600, 1400]) {
      const arms = armsAt(gestureTracks([{ kind, at_ms: 0 }]), t, "ready", { kind: "sword" });
      const back = armsFromRig(rigFromArms(arms));
      const a = points(arms);
      const b = points(back);
      a.forEach((p, i) => assert.ok(dist(p, b[i]) < 1e-6, `${kind} @${t} point ${i}: ${dist(p, b[i])}`));
      assert.ok(dist(arms.lead.palm.normal, back.lead.palm.normal) < 1e-6, `${kind} palm`);
      assert.ok(dist(arms.lead.blade, back.lead.blade) < 1e-6, `${kind} blade`);
    }
  }
});

test("bones keep their lengths in every pose", () => {
  const arms = armsAt(gestureTracks([{ kind: "spin_throw", at_ms: 0 }]), 400, "ready");
  const rig = applyRoot(rigFromArms(arms), rootOf({ lean: 0.3, yaw: 1.1, push: 0.2, lift: 0.1, shiver: 0 }));
  const pos = rigPositions(rig);
  for (const b of ALL_BONES) {
    const p = PARENT[b];
    if (!p) continue;
    assert.ok(Math.abs(dist(pos[b], pos[p]) - dist(REST.pos[b], REST.pos[p])) < 1e-9, b);
  }
});

function bake(list, rest = "ready", weapon = null, fps = 30, ms = 1500) {
  const tracks = gestureTracks(list);
  const times = Array.from({ length: Math.round((ms / 1000) * fps) }, (_, i) => (i * 1000) / fps);
  return { times, fps, arms: times.map((t) => armsAt(tracks, t, rest, weapon)), frames: times.map((t) => rigFromArms(armsAt(tracks, t, rest, weapon))) };
}

test("a baked clip plays back the gestures it was baked from", () => {
  const b = bake([{ kind: "throw", at_ms: 100 }, { kind: "clap", at_ms: 800 }]);
  const clip = JSON.parse(JSON.stringify(makeClip(b.frames, b.fps, { name: "t" })));
  assert.equal(clip.format, "spelldirector.clip/1");
  assert.equal(clip.frame_count, b.frames.length);
  // Legs and spine never move: left out, they follow their parents.
  assert.ok(!clip.rotations.LeftUpLeg && !clip.rotations.Spine);
  b.times.forEach((t, i) => {
    const back = armsFromRig(sampleClip(clip, t));
    const a = points(b.arms[i]);
    points(back).forEach((p, k) => assert.ok(dist(p, a[k]) < 2e-4, `frame ${i} point ${k}`));
  });
  // Between frames it blends; past the end it holds the last frame.
  const end = armsFromRig(sampleClip(clip, 99999));
  assert.ok(dist(end.lead.hand, b.arms.at(-1).lead.hand) < 2e-4);
});

test("a mirrored clip swaps the hands", () => {
  const b = bake([{ kind: "point", at_ms: 0, hold_ms: 5000 }]);
  const clip = makeClip(b.frames, b.fps);
  const plain = armsFromRig(sampleClip(clip, 900));
  const mirrored = armsFromRig(sampleClip(clip, 900, { mirror: true }));
  const flip = (p) => [p[0], p[1], -p[2]];
  assert.ok(dist(mirrored.off.tip, flip(plain.lead.tip)) < 2e-4);
  assert.ok(dist(mirrored.lead.hand, flip(plain.off.hand)) < 2e-4);
});

test("a clip blends in before at_ms and out after its end", () => {
  const clip = { duration_ms: 1000, loop: false };
  const def = { clip: "x", at_ms: 500, blend_ms: 200 };
  assert.equal(clipPlayback(def, clip, 200).weight, 0);
  assert.ok(clipPlayback(def, clip, 400).weight > 0 && clipPlayback(def, clip, 400).weight < 1);
  assert.equal(clipPlayback(def, clip, 900).weight, 1);
  assert.equal(clipPlayback(def, clip, 900).ms, 400);
  assert.equal(clipPlayback({ ...def, speed: 2, from_ms: 100 }, clip, 700).ms, 500);
  assert.equal(clipPlayback(def, clip, 1500).weight, 1, "ends at 1500");
  assert.ok(clipPlayback(def, clip, 1600).weight < 1, "then blends out");
  assert.equal(clipPlayback(def, clip, 1800).weight, 0);
});

test("clips are registered by name and templates ask for theirs", () => {
  const b = bake([{ kind: "raise", at_ms: 0 }], "ready", null, 10, 300);
  assert.ok(registerClip("raise-test", makeClip(b.frames, 10)));
  assert.ok(!registerClip("bad", { format: "nope" }));
  assert.ok(getClip("raise-test"));
  assert.deepEqual(clipsWanted({ space: { caster_clip: { clip: "raise-test" } } }), ["raise-test"]);
  assert.deepEqual(clipsWanted({ space: {} }), []);
  const def = schema.properties.space.properties.caster_clip;
  assert.deepEqual(def.required, ["clip"]);
  for (const k of ["at_ms", "from_ms", "to_ms", "speed", "mirror", "blend_ms", "hold_ms"]) assert.ok(def.properties[k], k);
});

// Multiply out a glTF node's world rotation from the local rotations at one key.
function worldRotations(json, accessor, key) {
  const local = json.nodes.map((n) => n.rotation || [0, 0, 0, 1]);
  for (const ch of json.animations[0].channels) {
    if (ch.target.path !== "rotation") continue;
    const out = accessor(json.animations[0].samplers[ch.sampler].output);
    local[ch.target.node] = out.slice(key * 4, key * 4 + 4);
  }
  const parent = [];
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const world = (i) => (parent[i] == null ? local[i] : qmul(world(parent[i]), local[i]));
  return Object.fromEntries(json.nodes.map((n, i) => [n.name, world(i)]));
}

test("the GLB holds a Mixamo-named skinned skeleton, sockets, points and the animation", () => {
  const b = bake([{ kind: "slash", at_ms: 100 }], "blade", { kind: "sword" });
  const bytes = casterGlb({ name: "keen", frames: b.frames, fps: b.fps, weapon: { kind: "sword" }, points: { primary_target: [1.25, 0, 0] } });
  const { json, accessor } = readGlb(bytes);
  const names = json.nodes.map((n) => n.name);
  for (const bone of HUMANOID) assert.ok(names.includes(`mixamorig:${bone}`), bone);
  for (const s of ["caster_hand", "caster_fingertip", "caster_blade_tip", "caster_hands"]) assert.ok(names.includes(`socket_${s}`), s);
  assert.ok(names.includes("point_primary_target"));
  const skin = json.skins[0];
  assert.equal(skin.joints.length, accessor(skin.inverseBindMatrices).length / 16);
  assert.equal(json.animations[0].name, "keen");
  const times = accessor(json.animations[0].samplers[0].input);
  assert.equal(times.length, b.frames.length);
  // The hand's world rotation in the file is the rig's, turned into glTF space.
  for (const key of [0, 12, 20]) {
    const w = worldRotations(json, accessor, key);
    for (const bone of ["LeftHand", "LeftHandIndex2", "RightForeArm", "LeftArm"]) {
      const want = toGltfQ(b.frames[key].rot[bone]);
      const got = w[`mixamorig:${bone}`];
      const d = Math.abs(want[0] * got[0] + want[1] * got[1] + want[2] * got[2] + want[3] * got[3]);
      assert.ok(d > 0.9999, `${bone} key ${key}: ${d}`);
    }
  }
  // A rig root move goes on the hips.
  const hipsT = json.animations[0].channels.find((c) => c.target.path === "translation" && json.nodes[c.target.node].name === "mixamorig:Hips");
  assert.ok(hipsT);
});

test("the timeline ties every event to a socket on the bones or a world point", () => {
  const b = bake([{ kind: "throw", at_ms: 100, duration_ms: 400 }]);
  const template = { id: "zap", name: "Zap", element: "lightning", archetype: "projectile", timing: { duration_ms: 1500 } };
  const manifest = {
    duration_ms: 1500,
    beats: [{ id: "release", phase: "release", start_ms: 500, end_ms: 700 }],
    layers: [
      { id: "orb", type: "orb", start_ms: 0, end_ms: 520, anchor: "caster_hand", blend: "add", colors: ["#fff"] },
      { id: "hit", type: "flash", start_ms: 900, end_ms: 1100, anchor: "target", blend: "add", colors: ["#fff"] },
    ],
    sounds: [{ at_ms: 500, cue: "zap", file: "sound-zap.wav", volume_db: -3, pitch: 1, loop: false }],
  };
  const { files, timeline } = rigExportFiles({ template, seed: 3, fps: b.fps, times: b.times, frames: b.frames, points: { primary_target: [4, 0, 0] }, gestures: [{ kind: "throw", at_ms: 100, duration_ms: 400 }], manifest });
  assert.deepEqual(files.map((f) => f.name), ["zap.caster.glb", "zap.caster.clip.json", "zap.timeline.json"]);
  assert.equal(timeline.format, "spelldirector.timeline/1");
  const gesture = timeline.events.find((e) => e.kind === "gesture");
  assert.equal(gesture.release_ms, 500);
  assert.equal(gesture.bone_side, "Left");
  const orb = timeline.events.find((e) => e.layer === "orb");
  assert.equal(orb.socket, "caster_hand");
  assert.equal(timeline.sockets.caster_hand.bone, "mixamorig:LeftHand");
  assert.equal(timeline.events.find((e) => e.layer === "hit").point, "primary_target");
  assert.deepEqual(timeline.points.primary_target.position_m, toGltf([4, 0, 0]).map((v) => Math.round(v * 1e4) / 1e4));
  assert.ok(timeline.events.some((e) => e.kind === "sound" && e.t_ms === 500));
  for (let i = 1; i < timeline.events.length; i++) assert.ok(timeline.events[i].t_ms >= timeline.events[i - 1].t_ms);
  // Socket tracks: the hand socket sits on the drawn hand every frame.
  assert.equal(timeline.socket_tracks.caster_hand.length, b.frames.length * 3);
  b.frames.forEach((fr, i) => {
    const want = toGltf(b.arms[i].lead.hand);
    const got = timeline.socket_tracks.caster_hand.slice(i * 3, i * 3 + 3);
    assert.ok(dist(want, got) < 1e-3, `frame ${i}`);
  });
  assert.ok(buildTimeline({ template, fps: 30, times: [], frames: [], manifest: {} }).events.length === 0);
});

test("sockets sit where the arms put the anchors", () => {
  const arms = armsAt(gestureTracks([{ kind: "chop", at_ms: 0 }]), 400, "blade", { kind: "greatsword" });
  const at = socketsAt(rigFromArms(arms), socketDefs({ kind: "greatsword" }));
  assert.ok(dist(at.caster_hand, arms.lead.hand) < 1e-9);
  assert.ok(dist(at.caster_off_hand, arms.off.hand) < 1e-9);
  assert.ok(dist(at.caster_fingertip, arms.lead.tip) < 1e-9);
  assert.ok(dist(at.caster_blade_tip, arms.blade.tip) < 1e-9);
  assert.ok(dist(at.caster_blade, arms.blade.mid) < 1e-9);
  assert.deepEqual(QI, [0, 0, 0, 1]);
  assert.ok(qconj);
});

test("timeline events answer to their layer's on/off switch", () => {
  const b = bake([{ kind: "throw", at_ms: 0 }], "ready", null, 10, 300);
  const toggles = { about: "x", layers: [{ id: "orb", type: "orb", stage: "core", build_step: 1, default_on: true }] };
  const t = buildTimeline({
    template: { id: "z", name: "Z" }, fps: 10, times: b.times, frames: b.frames,
    manifest: { layer_toggles: toggles, layers: [{ id: "orb", type: "orb", start_ms: 0, end_ms: 200, anchor: "caster_hand" }], sounds: [{ at_ms: 100, cue: "zap", layer: "orb" }] },
  });
  assert.deepEqual(t.layer_toggles, toggles);
  for (const e of t.events.filter((x) => x.layer)) assert.equal(e.toggle, e.layer);
  assert.ok(!t.events.find((x) => x.kind === "gesture")?.toggle);
});
