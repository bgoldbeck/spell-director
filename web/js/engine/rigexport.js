// The caster rig export, for rebuilding a spell in Unity (or any engine):
//
// - <id>.caster.glb: the caster's skeleton with Mixamo bone names, a crude
//   skinned stick mesh, socket nodes on the bones where effects attach, the
//   spell's world points, and the casting animation baked at the export's
//   frame rate. Unity imports it (through glTFast, or as FBX after
//   tools/blender_glb_to_fbx.py) as a Humanoid, so the animation retargets
//   onto any Humanoid character.
// - <id>.caster.clip.json: the same animation as a "spelldirector.clip/1"
//   clip, which SpellDirector can play back (space.caster_clip).
// - <id>.timeline.json ("spelldirector.timeline/1"): every effect event keyed
//   to time and to a bone socket or a world point, plus per-frame socket
//   positions, so a script or an AI can build the spell around the animation.
//
// Pure (no Three.js): the page gathers the rig poses and points from the
// stage (web/js/exporter.js) and Node can test everything here.

import { GltfBuilder } from "./glb.js";
import { BODY, WEAPONS, gestureInfo } from "./gesture.js";
import { ALL_BONES, PARENT, QI, REST, WEAPON_BONE, makeClip, mixamoName, qconj, qmul, qnorm, qrot, rigPositions } from "./rig.js";

export const TIMELINE_FORMAT = "spelldirector.timeline/1";
/** Meters per SpellDirector unit (one character height): an average adult. */
export const METERS_PER_UNIT = 1.8;
export const RIG_ROOT = "SpellDirector_Caster";
export const POINTS_ROOT = "SpellDirector_Points";

export const rigFileNames = (id) => ({ glb: `${id}.caster.glb`, clip: `${id}.caster.clip.json`, timeline: `${id}.timeline.json` });

// SpellDirector body space (+X forward, +Y up, -Z left, 1 unit = height)
// to glTF (+Z forward, +Y up, +X left, meters): a quarter turn about Y.
const H = METERS_PER_UNIT;
const QM = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const toGltf = (v, scale = H) => [-v[2] * scale, v[1] * scale, v[0] * scale];
export const toGltfQ = (q) => qnorm(qmul(qmul(QM, q), qconj(QM)));
/** glTF position -> Unity (left-handed: glTF importers negate x). */
export const gltfToUnity = (g) => [-g[0], g[1], g[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Where the effects' caster anchors sit on the skeleton: { anchor: { bone,
 * offset (body units, from the bone, rest frame) } }, or { between: [a, b] }.
 */
export function socketDefs(weapon) {
  const w = WEAPONS[weapon?.kind] || WEAPONS.sword;
  const L = Number(weapon?.length) > 0 ? Number(weapon.length) : w.length;
  const d = REST.arms.Left.blade;
  const guard = BODY.palmWidth * 0.62;
  return {
    caster_hand: { bone: "LeftHand", offset: sub(REST.arms.Left.hand, REST.pos.LeftHand) },
    caster_off_hand: { bone: "RightHand", offset: sub(REST.arms.Right.hand, REST.pos.RightHand) },
    caster_fingertip: { bone: "LeftHandIndex4", offset: [0, 0, 0] },
    caster_off_fingertip: { bone: "RightHandIndex4", offset: [0, 0, 0] },
    caster_hands: { between: ["caster_hand", "caster_off_hand"] },
    caster_blade: { bone: WEAPON_BONE, offset: mul(d, guard + L * 0.55) },
    caster_blade_tip: { bone: WEAPON_BONE, offset: mul(d, guard + L) },
  };
}

/** Socket positions (body/world units) for one rig pose. */
export function socketsAt(rig, defs) {
  const pos = rigPositions(rig);
  const out = {};
  for (const [name, s] of Object.entries(defs)) {
    if (s.between) continue;
    const q = rig.rot[s.bone] || QI;
    out[name] = add(pos[s.bone], qrot(q, s.offset));
  }
  for (const [name, s] of Object.entries(defs)) {
    if (!s.between) continue;
    const [a, b] = s.between.map((k) => out[k]);
    out[name] = mul(add(a, b), 0.5);
  }
  out.caster = [0, 0, 0];
  return out;
}

// Stick radii for the crude mesh (figure units), by bone.
function radiusOf(bone) {
  if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(bone)) return 0.008;
  if (bone === "HeadTop_End") return 0.1;
  if (/Spine|Hips/.test(bone)) return 0.07;
  if (/ForeArm|Hand$/.test(bone)) return 0.028;
  if (/Arm$/.test(bone)) return 0.034;
  if (/UpLeg|Leg$/.test(bone)) return 0.05;
  if (/Foot|Toe/.test(bone)) return 0.03;
  return 0.03;
}

/**
 * The caster as a .glb: bones named like Mixamo's ("mixamorig:LeftHand"),
 * rest pose a T-pose with every bone's rest rotation the identity, a stick
 * mesh skinned to them, socket nodes, the spell's points and one animation.
 * frames: rig poses (engine/rig.js, root folded in) at fps.
 */
export function casterGlb({ name, frames, fps, weapon = null, points = {}, generator = "SpellDirector" }) {
  const g = new GltfBuilder(generator);
  const bones = weapon ? ALL_BONES : ALL_BONES.filter((b) => b !== WEAPON_BONE);
  const root = g.node({ name: RIG_ROOT });
  const nodeOf = {};
  for (const b of bones) {
    const parent = PARENT[b];
    const t = parent ? toGltf(sub(REST.pos[b], REST.pos[parent])) : toGltf(REST.pos[b]);
    nodeOf[b] = g.node({ name: mixamoName(b), translation: t.map(r4) }, parent ? nodeOf[parent] : root);
  }
  const defs = socketDefs(weapon);
  const socketNodes = {};
  for (const [sname, s] of Object.entries(defs)) {
    if (s.between || (s.bone === WEAPON_BONE && !weapon)) continue;
    socketNodes[sname] = g.node({ name: `socket_${sname}`, translation: toGltf(s.offset).map(r4) }, nodeOf[s.bone]);
  }
  socketNodes.caster_hands = g.node({ name: "socket_caster_hands" }, root);

  // The crude mesh: a four-sided stick from each bone to each child, skinned to the bone.
  const P = [];
  const J = [];
  const W = [];
  const I = [];
  const jointIndex = Object.fromEntries(bones.map((b, i) => [b, i]));
  const stick = (a, b, r, joint) => {
    const d = sub(b, a);
    const l = Math.hypot(...d) || 1;
    const dir = mul(d, 1 / l);
    const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = (() => {
      const c = [dir[1] * ref[2] - dir[2] * ref[1], dir[2] * ref[0] - dir[0] * ref[2], dir[0] * ref[1] - dir[1] * ref[0]];
      const n = Math.hypot(...c);
      return mul(c, 1 / n);
    })();
    const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
    const mid = add(a, mul(d, 0.2));
    const base = P.length / 3;
    const verts = [a, add(mid, mul(u, r)), add(mid, mul(v, r)), add(mid, mul(u, -r)), add(mid, mul(v, -r)), b];
    for (const p of verts) {
      P.push(...toGltf(p));
      J.push(jointIndex[joint], 0, 0, 0);
      W.push(1, 0, 0, 0);
    }
    for (let k = 0; k < 4; k++) {
      const p1 = base + 1 + k;
      const p2 = base + 1 + ((k + 1) % 4);
      I.push(base, p2, p1, p1, p2, base + 5);
    }
  };
  for (const b of bones) {
    const parent = PARENT[b];
    if (!parent || b === WEAPON_BONE) continue;
    stick(REST.pos[parent], REST.pos[b], radiusOf(b), parent);
  }
  if (weapon) {
    const tip = add(REST.pos[WEAPON_BONE], defs.caster_blade_tip.offset);
    stick(REST.pos[WEAPON_BONE], tip, 0.02, WEAPON_BONE);
  }
  const material = g.add("materials", { name: "SpellDirector_StandIn", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.55, 0.57, 0.63, 1], metallicFactor: 0, roughnessFactor: 0.8 } });
  const mesh = g.add("meshes", {
    name: "SpellDirector_StandIn",
    primitives: [{
      attributes: {
        POSITION: g.accessor(P, "VEC3", { target: 34962, minmax: true }),
        JOINTS_0: g.accessor(J, "VEC4", { kind: "ubyte", target: 34962 }),
        WEIGHTS_0: g.accessor(W, "VEC4", { target: 34962 }),
      },
      indices: g.accessor(I, "SCALAR", { kind: "ushort", target: 34963 }),
      material,
    }],
  });
  // Rest rotations are all the identity: the inverse bind matrix of a joint
  // just undoes its rest position.
  const ibm = [];
  for (const b of bones) {
    const p = toGltf(REST.pos[b]);
    ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1);
  }
  const skin = g.add("skins", { name: "SpellDirector_Caster", joints: bones.map((b) => nodeOf[b]), inverseBindMatrices: g.accessor(ibm, "MAT4"), skeleton: nodeOf.Hips });
  // A skinned mesh sits at the scene root (glTF ignores its parents' transforms).
  g.node({ name: "SpellDirector_StandIn", mesh, skin });

  // The spell's world points (targets, the sky point...), for placing effects.
  const pr = g.node({ name: POINTS_ROOT });
  for (const [pname, p] of Object.entries(points)) g.node({ name: `point_${pname}`, translation: toGltf(p).map(r4) }, pr);

  // The animation: each bone's local rotation (parent's world rotation undone).
  if (frames.length) {
    const times = frames.map((_, i) => i / fps);
    const input = g.accessor(times, "SCALAR", { minmax: true });
    const samplers = [];
    const channels = [];
    const channel = (node, path, values, type) => {
      samplers.push({ input, output: g.accessor(values, type), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    const world = frames.map((fr) => Object.fromEntries(bones.map((b) => [b, toGltfQ(fr.rot[b] || (PARENT[b] ? fr.rot[PARENT[b]] : QI) || QI)])));
    for (const b of bones) {
      const vals = [];
      let moved = false;
      let prev = null;
      world.forEach((w) => {
        const parent = PARENT[b];
        let q = parent ? qnorm(qmul(qconj(w[parent]), w[b])) : w[b];
        // Keep neighbouring keys on the same hemisphere so LINEAR blends the short way.
        if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((x) => -x);
        prev = q;
        if (Math.abs(q[3]) < 0.99999) moved = true;
        vals.push(...q);
      });
      if (moved || b === "Hips") channel(nodeOf[b], "rotation", vals, "VEC4");
    }
    channel(nodeOf.Hips, "translation", frames.flatMap((fr) => toGltf(add(REST.pos.Hips, fr.hips || [0, 0, 0]))), "VEC3");
    const defsNow = socketDefs(weapon);
    channel(socketNodes.caster_hands, "translation", frames.flatMap((fr) => toGltf(socketsAt(fr, defsNow).caster_hands)), "VEC3");
    g.add("animations", { name, samplers, channels });
  }
  return g.toGlb();
}

// Which socket or world point an anchor means.
function binding(anchor) {
  const a = anchor || "target";
  if (a.startsWith("caster_") || a === "caster") return { socket: a };
  if (a === "target") return { point: "primary_target", per_target: "target_<k> (chains hit each target in turn)" };
  if (a === "ground") return { point: "primary_target" };
  if (a === "splash") return { point: "splash_<k>", per_target: "one per splash target, delayed as the splash ripples out" };
  return { point: a };
}

/**
 * The timeline sidecar: what happens when, attached where. src: {
 * template, seed, version, fps, times, frames, weapon, points (name ->
 * body/world position), gestures (resolved), driver, manifest (the sprite
 * export's, for layers, beats, sounds, lights...) }.
 */
export function buildTimeline(src) {
  const { template, seed = 1, fps, times, frames, weapon = null, points = {}, gestures = [], manifest = {}, driver = "gestures" } = src;
  const id = template.id;
  const files = rigFileNames(id);
  const defs = socketDefs(weapon);
  const boneSocket = (s) => (s.between ? { between: s.between } : { bone: mixamoName(s.bone), offset_m: toGltf(s.offset).map(r4) });
  const sockets = {};
  for (const [k, s] of Object.entries(defs)) {
    if (s.bone === WEAPON_BONE && !weapon) continue;
    sockets[k] = { node: `socket_${k}`, ...boneSocket(s) };
  }
  sockets.caster = { node: RIG_ROOT, bone: null, about: "The caster's feet (the rig's root)." };
  const tracks = Object.fromEntries(Object.keys(sockets).map((k) => [k, []]));
  for (const fr of frames) {
    const at = socketsAt(fr, defs);
    for (const k of Object.keys(tracks)) tracks[k].push(...toGltf(at[k] || [0, 0, 0]).map(r4));
  }
  const pointsOut = Object.fromEntries(Object.entries(points).map(([k, p]) => {
    const gp = toGltf(p).map(r4);
    return [k, { node: `point_${k}`, position_m: gp, unity_position_m: gltfToUnity(gp) }];
  }));
  const events = [];
  for (const g of gestures) {
    const info = gestureInfo(g.kind);
    if (!info) continue;
    const dur = Number(g.duration_ms) || info.duration_ms;
    events.push({
      t_ms: g.at_ms,
      kind: "gesture",
      gesture: g.kind,
      hand: info.two_handed ? "both" : g.hand || "lead",
      bone_side: info.two_handed || g.hand === "both" ? "both" : (g.hand || "lead") === "lead" ? "Left" : "Right",
      release_ms: g.at_ms + dur,
      rest_by_ms: g.at_ms + dur + (Number.isFinite(g.hold_ms) ? g.hold_ms : 250) + (Number.isFinite(g.return_ms) ? g.return_ms : 400),
    });
  }
  for (const b of manifest.beats || []) events.push({ t_ms: b.start_ms, kind: "beat", beat: b.id, phase: b.phase, end_ms: b.end_ms, intent: b.intent });
  for (const l of manifest.layers || []) {
    if (l.empty && l.start_ms == null) continue;
    const start = l.start_ms ?? l.beat_window_ms?.[0] ?? 0;
    const end = l.end_ms ?? l.beat_window_ms?.[1] ?? start;
    events.push({
      t_ms: start,
      kind: "layer",
      layer: l.id,
      type: l.type,
      end_ms: end,
      anchor: l.anchor,
      ...binding(l.anchor),
      follows: l.attach_to ? binding(l.attach_to) : null,
      plane: l.plane,
      blend: l.blend,
      colors: l.colors,
      z: l.z,
      loop: l.loop,
      shader: l.shader || null,
      engine_hints: l.engine_hints || null,
      sheet: l.image || null,
    });
  }
  for (const s of manifest.sounds || []) events.push({ t_ms: s.at_ms ?? 0, kind: "sound", cue: s.cue, file: s.file || null, layer: s.layer || null, end_ms: s.end_ms ?? null, volume_db: s.volume_db, pitch: s.pitch, loop: !!s.loop });
  for (const l of manifest.lights || []) events.push({ t_ms: l.start_ms ?? 0, kind: "light", layer: l.layer, end_ms: l.end_ms ?? null, ...binding(l.anchor), offset_units: l.offset_units, color: l.color, radius_m: r4((l.radius_units || 0) * H) });
  for (const s of manifest.screen_flashes || []) events.push({ t_ms: s.start_ms ?? 0, kind: "screen_flash", layer: s.layer, end_ms: s.end_ms ?? null, color: s.color });
  if (manifest.camera_shake?.length) events.push({ t_ms: manifest.camera_shake[0].start_ms ?? 0, kind: "camera_shake", see: "camera_shake in the sprite sheet JSON" });
  // Every layer's events answer to that layer's on/off switch.
  for (const e of events) if (e.layer) e.toggle = e.layer;
  events.sort((a, b) => a.t_ms - b.t_ms || (a.kind === "gesture" ? -1 : 0));

  return {
    format: TIMELINE_FORMAT,
    how_to_use: [
      "Rebuild the spell around the caster's animation.",
      `Import ${files.glb} as a Humanoid (Unity: glTFast, or convert it to FBX with tools/blender_glb_to_fbx.py and set Rig > Animation Type to Humanoid; the mixamorig bone names map automatically).`,
      "Play its animation on your caster; it retargets onto any Humanoid character.",
      "For each event, at t_ms: a gesture is the arm movement (release_ms is when a throw lets go); a layer starts at its socket (a node on the caster's bones, follow it while the layer lasts) or at a world point, and stops at end_ms.",
      "Build it one layer at a time in layer_toggles order: every layer gets its own on/off switch (a child object per layer, named by its id) and the driver skips events whose toggle is off. Switch each layer on alone and check it against its sheet before adding the next, and keep the switches in the finished spell.",
      "socket_tracks give every socket's position each frame, in case you place effects without the rig.",
      "Layers' looks (shader intent, colors, blend) are in the sprite sheet JSON and guide; the sheets show what each layer should look like.",
    ].join(" "),
    generator: `SpellDirector ${src.version || ""}`.trim(),
    template: { id, name: template.name, element: template.element, archetype: template.archetype },
    seed,
    duration_ms: manifest.duration_ms ?? template.timing?.duration_ms ?? 0,
    loop: !!manifest.loop,
    loop_range: manifest.loop_range || null,
    fps,
    frame_count: frames.length,
    frame_times_ms: times.map((t) => Math.round(t * 1000) / 1000),
    units: { meters_per_unit: H, about: `Positions are in meters; SpellDirector's one-character-height unit is ${H} m.` },
    coordinates:
      "glTF space: right-handed, +Y up, the caster stands at the origin facing +Z, +X is the caster's left. Unity's glTF and FBX importers flip x, so unity_position_m (and Unity = (-x, y, z)) gives Unity world positions with the caster at the origin facing +Z.",
    caster: {
      rig: "mixamo",
      files,
      animation: id,
      driven_by: driver,
      casting_hand: "left",
      about:
        "The casting hand (SpellDirector's lead hand, where caster_hand is) is the caster's LEFT hand. For a right-handed character, tick Mirror on the Unity animation clip and swap Left and Right in the sockets.",
      bones: ALL_BONES.filter((b) => b !== WEAPON_BONE || weapon).map(mixamoName),
      weapon: weapon ? { kind: weapon.kind || "sword", bone: mixamoName(WEAPON_BONE), length_m: r4((Number(weapon.length) || (WEAPONS[weapon.kind] || WEAPONS.sword).length) * H) } : null,
    },
    sockets,
    points: pointsOut,
    layer_toggles: manifest.layer_toggles || null,
    events,
    socket_tracks: tracks,
  };
}

/** Everything the rig export writes: [{ name, data }]. */
export function rigExportFiles(src) {
  const files = rigFileNames(src.template.id);
  const clip = makeClip(src.frames, src.fps, { name: src.template.id, source: "spelldirector", loop: false });
  const glb = casterGlb({ name: src.template.id, frames: src.frames, fps: src.fps, weapon: src.weapon, points: src.points, generator: `SpellDirector ${src.version || ""}`.trim() });
  const timeline = buildTimeline(src);
  return {
    timeline,
    files: [
      { name: files.glb, data: glb },
      { name: files.clip, data: `${JSON.stringify(clip)}\n` },
      { name: files.timeline, data: `${JSON.stringify(timeline, null, 2)}\n` },
    ],
  };
}
