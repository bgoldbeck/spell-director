// Sprite sheet export: the pure part. Plans frames and sheet layout, builds
// the JSON manifest and writes the assembly guide (Markdown). No DOM or WebGL,
// so it runs in Node tests; web/js/exporter.js does the rendering.
//
// One sheet per layer, plus one for the whole spell. Columns are frames (only
// the frames where that layer shows), rows are the views (front, side, top,
// 3/4), so one column holds every view of the same moment. Every cell is the
// same size, and each view uses the same camera in every sheet, so cells line
// up pixel for pixel across sheets. A sheet wider than the limit wraps into
// further blocks of view rows.

import { layerIntensity, layerLoop, layerWindow, loopRange, paramAtFrom, resolveParams } from "./timeline.js";
import { soundSheet } from "./sound.js";
import { decalBlend, decalFillState, decalPlan, decalState } from "./decal.js";
import { HOW_TO_USE, describeShader, engineRecipe, shaderFor } from "./shader.js";
import { DECAL_FILLS, STYLES, decalRender, resolveStyle, shaderForStyle, styleGuideLines, styleRecipe } from "./style.js";
import { SIXWAY_EXPORT_PX, SIXWAY_FRAMES, smokeLighting } from "./sixway.js";
import { TRACKING, resolveReadability, trackingFor } from "./readability.js";
import { referenceChecklist, referenceChecklistLines } from "./references.js";

export const FORMAT = "spelldirector.spritesheet/1";
export const SHEET_VIEWS = ["front", "side", "top", "three_quarter"];
export const VIEW_NAMES = { front: "Front", side: "Side", top: "Top", three_quarter: "3/4" };
export const DEFAULTS = { frame: 192, maxWidth: 4096 };
export const ALL_ID = "all";

const DEFAULT_PLANE = {
  ring: "ground", decal: "ground",
  glow: "billboard", orb: "billboard", flash: "billboard", light: "billboard",
};

// How a layer gets to the engine:
// - "sprite": drawn, gets its own sheet
// - "screen_flash": a full-screen tint (color + opacity curve), not drawn
// - "camera_shake": a camera offset envelope, not drawn
// - "light": a dynamic light (color + energy curve), not drawn
// - "sound": a sound cue schedule, not drawn
export function layerKind(layer) {
  switch (layer.type) {
    case "sound_cue":
      return "sound";
    case "camera_shake":
      return "camera_shake";
    case "light":
      return "light";
    case "flash":
      return layer.params?.scope === "screen" ? "screen_flash" : "sprite";
    default:
      return "sprite";
  }
}

export function spriteLayers(template) {
  return [...(template.layers || [])]
    .filter((l) => layerKind(l) === "sprite")
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

// Frame times. Frame i shows time i * 1000 / fps.
export function framePlan(template, { fps } = {}) {
  const duration = template.timing?.duration_ms ?? 1000;
  const f = Math.max(1, Math.min(120, Math.round(fps || template.timing?.fps_hint || 30)));
  const frameMs = 1000 / f;
  const count = Math.max(1, Math.ceil((duration * f) / 1000 - 1e-9));
  const times = Array.from({ length: count }, (_, i) => i * frameMs);
  return { fps: f, frameMs, count, duration, times };
}

export function frameAt(plan, ms) {
  return Math.max(0, Math.min(plan.count - 1, Math.floor(ms / plan.frameMs + 1e-9)));
}

// First and last frame index where a predicate holds (null if never).
export function visibleRange(flags) {
  let first = -1;
  let last = -1;
  flags.forEach((on, i) => {
    if (!on) return;
    if (first < 0) first = i;
    last = i;
  });
  return first < 0 ? null : { first, last };
}

// Layout of one sheet: `count` frames across, one row per view.
export function layoutSheet(count, viewCount, { frame = DEFAULTS.frame, maxWidth = DEFAULTS.maxWidth } = {}) {
  const n = Math.max(1, count);
  const columns = Math.max(1, Math.min(n, Math.floor(maxWidth / frame)));
  const blocks = Math.ceil(n / columns);
  const rows = blocks * Math.max(1, viewCount);
  return { frame, columns, blocks, rows, views: viewCount, width: columns * frame, height: rows * frame };
}

// Pixel rect of frame k (0 = the sheet's first frame) for the view in row
// `viewRow`; top-left origin, y down.
export function cellRect(layout, viewRow, k) {
  const col = k % layout.columns;
  const row = Math.floor(k / layout.columns) * layout.views + viewRow;
  return { x: col * layout.frame, y: row * layout.frame, w: layout.frame, h: layout.frame };
}

export function decalFileName(id) {
  return `decal-${id}.png`;
}

export const DECAL_TEXTURE_PX = 512;

export function decalMapName(id, kind) {
  return `decal-${id}-${kind}.png`;
}

// Decals for an engine's decal projector: a top-down texture per decal layer
// plus its timing and per-frame curves (opacity 0-1, scale x full size,
// rotation in degrees). Viewer and export share decalPlan/decalState.
export function buildDecals(template, seed, plan, style = resolveStyle(template)) {
  const chain = template.space?.travel === "chain";
  return (template.layers || []).filter((l) => l.type === "decal").map((l) => {
    const d = decalPlan(template, l, seed, 0);
    const states = plan.times.map((t) => decalState(d, t));
    const look = decalRender(d.shape, d.blend, d.look, style, l.color);
    const fill = look.fill !== "none";
    const fillStates = fill ? plan.times.map((t) => decalFillState(d, t, look.fill_in_ms)) : null;
    return {
      layer: l.id,
      shape: d.shape,
      blend: d.blend,
      texture: decalFileName(l.id),
      texture_px: DECAL_TEXTURE_PX,
      color: colorHexes(template, l.color)[0],
      anchor: l.anchor || "target",
      per_target: (chain && (l.anchor || "target") === "target") || l.anchor === "splash",
      // The texture's full width on the ground at scale 1, in world units (1 = one character height).
      size_units: r3((d.radius_px * 2.2) / 100),
      stretch: r3(d.stretch),
      opacity: r3(d.opacity),
      start_ms: r1(d.start_ms),
      fade_in_ms: r1(d.fade_in_ms),
      hold_until_ms: r1(d.hold_until_ms),
      fade_out_ms: r1(d.fade_out_ms),
      end_ms: r1(d.end_ms),
      outlives_spell: d.end_ms > plan.duration,
      grow_ms: r1(d.grow_ms),
      start_scale: r3(d.grow_ms > 0 ? d.start_scale : 1),
      rotation_deg: r1(d.rotation_deg),
      spin_deg_per_s: r1(d.spin_deg_per_s),
      pulse_hz: r3(d.pulse_hz),
      // A sector facing the cast direction (360 = the whole mark), and how
      // long the mark takes to spread out from its centre (0 = appears whole).
      arc_deg: r1(d.arc_deg),
      reveal_ms: r1(d.reveal_ms),
      // Depth (parallax; negative = raised) and what fills the bottom of the
      // mark (lava, glow, liquid, void), with their textures.
      depth: r3(look.depth),
      fill: look.fill,
      fill_colors: fill ? colorHexes(template, look.fill_color || l.color) : null,
      fill_in_ms: fill ? r1(look.fill_in_ms) : null,
      fill_flow: fill ? r3(look.fill_flow) : null,
      height_map: look.depth !== 0 ? decalMapName(l.id, "height") : null,
      emissive_mask: fill ? decalMapName(l.id, "emissive") : null,
      flow_map: fill && DECAL_FILLS[look.fill].flow ? decalMapName(l.id, "flow") : null,
      curves: {
        opacity: states.map((x) => r3(x.opacity)),
        scale: states.map((x) => r3(x.scale)),
        rotation_deg: states.map((x) => r1(x.rotation_deg)),
        reveal: states.map((x) => r3(x.reveal)),
        ...(fill ? { fill: fillStates.map((x) => r3(x.amount)), heat: fillStates.map((x) => r3(x.heat)) } : {}),
      },
    };
  });
}

export function sixwayMapName(id, sign) {
  return `smoke-${id}-sixway-${sign}.png`;
}

// Smoke layers drawn as six-way lit smoke in this style: their two packed
// lightmap flipbooks (engine/sixway.js) and how to read them.
export function buildSixWay(template, seed, style = resolveStyle(template)) {
  const cols = Math.ceil(Math.sqrt(SIXWAY_FRAMES));
  return (template.layers || [])
    .filter((l) => smokeLighting(l, style, shaderForStyle(shaderFor(l), style.id)) === "six_way")
    .map((l) => {
      const p = resolveParams(l.params, seed, `${l.id}#0`);
      return {
        layer: l.id,
        positive_map: sixwayMapName(l.id, "pos"),
        negative_map: sixwayMapName(l.id, "neg"),
        frame_px: SIXWAY_EXPORT_PX,
        columns: cols,
        rows: Math.ceil(SIXWAY_FRAMES / cols),
        frames: SIXWAY_FRAMES,
        // Frames run over one puff's life: play the flipbook once per particle lifetime.
        lifetime_ms: p.lifetime_ms ?? 500,
        color: colorHexes(template, l.color)[0],
        packing: {
          positive: "R = lit from the right (+X), G = from the top (+Y), B = from the back (behind the puff), A = alpha",
          negative: "R = lit from the left (-X), G = from below (-Y), B = from the front (the camera's side), A = emissive (thick core)",
          color_space: "linear (turn sRGB off on import)",
          frame_order: "left to right, top to bottom; frame 0 top left",
        },
      };
    });
}

export function sheetFileName(id) {
  return id === ALL_ID ? "all.png" : `layer-${id}.png`;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

function colorHexes(template, slot) {
  const p = template.palette || {};
  const get = (k) => (p[k] || p.primary || "#FFFFFF").toUpperCase();
  if (slot === "gradient_core_to_primary") return [get("core"), get("primary")];
  if (slot && p[slot]) return [get(slot)];
  return [get("primary")];
}

// Curve of a param * intensity per frame, for the layers that are not drawn.
function curve(template, layer, plan, seed, valueAt) {
  const base = resolveParams(layer.params, seed, `${layer.id}#0`);
  const start = layerWindow(template, layer)?.start ?? 0;
  const p = (name, t, fallback) => {
    const v = paramAtFrom(base, layer.keyframes, name, t, start);
    return v === undefined || v === null ? fallback : v;
  };
  return plan.times.map((t) => r3(valueAt(layerIntensity(template, layer, t, seed), p, t)));
}

// Tracks: everything an engine needs that is not a sprite.
export function buildTracks(template, seed, plan, cueLibrary = { cues: {} }) {
  const screenFlashes = [];
  const shakes = [];
  const lights = [];
  for (const l of template.layers || []) {
    const kind = layerKind(l);
    const win = layerWindow(template, l);
    const common = { layer: l.id, beats: l.beats || [], start_ms: win?.start ?? 0, end_ms: win?.end ?? 0 };
    if (kind === "screen_flash") {
      const dark = l.blend === "multiply";
      screenFlashes.push({
        ...common,
        mode: dark ? "multiply" : "add",
        color: colorHexes(template, l.color)[0],
        // Same factor the viewer uses: bright flashes are softened.
        opacity: curve(template, l, plan, seed, (I, p, t) => Math.min(dark ? 0.85 : 0.9, I * p("peak", t, 1) * (dark ? 1 : 0.35))),
      });
    } else if (kind === "camera_shake") {
      shakes.push({
        ...common,
        frequency_hz: curve(template, l, plan, seed, (I, p, t) => p("frequency_hz", t, 25))[0],
        // Peak offset in template pixels (100 px = one character height), already scaled by intensity.
        amplitude_px: curve(template, l, plan, seed, (I, p, t) => p("amplitude_px", t, 4) * 0.5 * I),
      });
    } else if (kind === "light") {
      const hex = colorHexes(template, l.color);
      const tint = typeof l.params?.tint === "string" && /^#[0-9a-fA-F]{6}$/.test(l.params.tint) ? l.params.tint.toUpperCase() : null;
      const p0 = resolveParams(l.params, seed, `${l.id}#0`);
      lights.push({
        ...common,
        anchor: l.anchor || "target",
        color: tint || hex[hex.length - 1],
        // Where it hangs from its anchor, in world units: x along the cast
        // direction, y up, z to the cast direction's right.
        offset_units: [r3((p0.forward_px ?? 0) / 100), r3((p0.height_px ?? 80) / 100), r3(-(p0.side_px ?? 0) / 100)],
        orbit_hz: r3(p0.orbit_hz ?? 0),
        radius_units: curve(template, l, plan, seed, (I, p, t) => p("radius", t, 6))[0],
        energy: curve(template, l, plan, seed, (I, p, t) => p("energy", t, 2) * I),
      });
    }
  }
  // Sound: the cue sheet (engine/sound.js), also written as <id>.sounds.json.
  const cues = cueLibrary.cues || {};
  const sheet = soundSheet(template, seed, cueLibrary, { frameOf: (ms) => frameAt(plan, ms) });
  const prompts = Object.fromEntries(sheet.cues.map((c) => [c.cue, c.prompt || ""]));
  const sounds = sheet.events.map((e) => ({
    ...e,
    samples: cues[e.cue]?.samples || [],
    sfx_prompt: prompts[e.cue] || "",
  }));
  const soundCues = sheet.cues;
  const soundStory = sheet.story;
  return { screen_flashes: screenFlashes, camera_shake: shakes, lights, sounds, sound_cues: soundCues, sound_story: soundStory };
}

// A layer's blend when the template doesn't say: smoke, rock and solid-looking
// coats (frost, stone, ice, shadow) are alpha-blended, the rest is light.
const ALPHA_COATS = new Set(["frost", "stone", "shadow", "ice"]);
function defaultBlend(l) {
  if (l.type === "smoke" || l.type === "eruption" || l.type === "motif") return "alpha";
  if (l.type === "coat") return ALPHA_COATS.has(l.params?.pattern) ? "alpha" : "add";
  return "add";
}

// sheets: [{id, first, count, layout}] (the whole-spell sheet first).
// visible: {layerId: {first, last} | null} over all exported views.
// views: {view: {pivots, px_per_unit, camera}} in row order.
// The order to rebuild a spell in an engine, one layer at a time: the hero
// layer first, then its support, then particles, then decals, then the
// finishing tracks (lights, screen flashes, shake, sound) and the timing pass.
export const BUILD_STAGES = [
  { stage: "core", types: ["bolt", "beam", "orb", "eruption", "vortex", "wave", "motif", "coat", "slash"], about: "the hero shape that reads as the spell on its own" },
  { stage: "secondary", types: ["glow", "crackle", "ring", "flash"], about: "glows, rings and crackle that support the core" },
  { stage: "particles", types: ["sparks", "smoke"], about: "sparks, spray and smoke" },
  { stage: "decals", types: ["decal"], about: "marks on the ground" },
];

export function buildOrder(template, layers) {
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  const steps = [];
  const finish = [];
  const staged = new Set(BUILD_STAGES.flatMap((st) => st.types));
  for (const st of BUILD_STAGES) {
    // A drawn layer of a type no stage names yet supports the core.
    const picked = (template.layers || [])
      .filter((l) => (st.types.includes(l.type) || (st.stage === "secondary" && !staged.has(l.type))) && layerKind(l) === "sprite")
      .map((l) => byId[l.id] || { id: l.id, type: l.type, z: l.z ?? 0, start_ms: layerWindow(template, l)?.start ?? 0 })
      .sort((a, b) => (st.stage === "core" ? (b.z ?? 0) - (a.z ?? 0) : 0) || (a.start_ms ?? 0) - (b.start_ms ?? 0) || (a.z ?? 0) - (b.z ?? 0));
    for (const l of picked) {
      steps.push({
        step: steps.length + 1,
        stage: st.stage,
        layer: l.id,
        type: l.type,
        sheet: l.image ?? null,
        plays_ms: l.start_ms == null ? null : [l.start_ms, l.end_ms],
        // The on/off switch this step builds (layer_toggles).
        toggle: l.id,
        verify: l.image
          ? `Render ${l.id} alone and compare it with its cells (sheet ${l.image}, every view): same timing, footprint, motion and colors. Match the feel, not the pixels.`
          : `Not drawn in the exported views; check it against the beat table and its shader intent.`,
      });
    }
  }
  for (const l of template.layers || []) {
    if (layerKind(l) !== "sprite" && layerKind(l) !== undefined) finish.push(l.id);
  }
  steps.push({
    step: steps.length + 1,
    stage: "finish",
    layers: finish,
    toggles: finish.slice(),
    about: "lights, screen flashes, camera shake and sound cues, then a timing pass over the whole spell",
    verify: "Play the whole spell next to all.png at the same frame rate, frame by frame through each beat, in every view your game uses.",
  });
  return steps;
}

/**
 * One on/off switch per layer, in build order: { about, layers: [{ id, type,
 * stage, build_step, default_on }] }. Every layer is its own switchable part
 * of the rebuilt effect (sprites, lights, flashes, shakes and sounds alike),
 * so it can be built and checked alone, then soloed or muted later.
 */
export function layerToggles(template, order) {
  const stepOf = {};
  const stageOf = {};
  for (const st of order) {
    for (const id of st.layer ? [st.layer] : st.layers || []) {
      stepOf[id] = st.step;
      stageOf[id] = st.stage;
    }
  }
  const layers = (template.layers || []).map((l) => ({
    id: l.id,
    type: l.type,
    stage: stageOf[l.id] || "finish",
    build_step: stepOf[l.id] ?? null,
    default_on: true,
  }));
  layers.sort((a, b) => (a.build_step ?? 1e9) - (b.build_step ?? 1e9));
  return {
    about:
      "Give every layer its own on/off switch, named by its id: a child object per layer under the spell's root, with an enabled flag the timeline driver checks before it spawns or plays that layer. Build them in build_step order, each switched on alone first and checked against its sheet, then together. Keep the switches in the finished effect (solo one layer, mute another) for tuning and debugging.",
    layers,
  };
}

function shaderInfo(l, blend, style, params) {
  const sh = shaderFor(l);
  if (!sh) return { shader: null, engine_hints: null };
  const { from_template: fromTemplate, ...base } = sh;
  const shader = shaderForStyle(base, style.id);
  // The realistic style lights smoke six ways even when the intent only says "lit".
  if (smokeLighting(l, style, shader) === "six_way") shader.lighting = "six_way";
  const hints = engineRecipe(l, shader, blend);
  const extra = styleRecipe(style.id, l, params);
  if (extra.unity.length) hints.unity.push(...extra.unity.map((x) => `${STYLES[style.id].label}: ${x}`));
  if (extra.godot.length) hints.godot.push(...extra.godot.map((x) => `${STYLES[style.id].label}: ${x}`));
  return { shader, shader_source: fromTemplate ? (l.shader?.styles?.[style.id] ? `template, with its ${style.id} refinement` : "template") : "default for this layer type", engine_hints: hints };
}

// An aura's seamless loop in frames: frames first_frame..end_frame-1 repeat
// while the aura lasts (end_frame looks the same as first_frame, so it is
// where the end section picks up). null for one-shot spells.
export function loopFrames(template, plan) {
  const lr = loopRange(template);
  if (!lr) return null;
  const first = Math.round(lr.start / plan.frameMs);
  const end = Math.max(first + 1, Math.round(lr.end / plan.frameMs));
  return {
    start_ms: lr.start,
    end_ms: lr.end,
    first_frame: first,
    end_frame: end,
    frame_count: end - first,
    frame_exact: Math.abs(lr.start / plan.frameMs - first) < 1e-6 && Math.abs(lr.end / plan.frameMs - end) < 1e-6,
    intro_frames: [0, first - 1],
    outro_frames: [end, plan.count - 1],
  };
}

export function buildManifest({ template, seed, plan, sheets, visible, views, tracks, version = "", frame, bloom = true, style = resolveStyle(template) }) {
  const loop = !!template.timing?.loop;
  const loopRangeOut = loopFrames(template, plan);
  const ms = (f) => r1(f * plan.frameMs);
  const viewOrder = Object.keys(views);
  const sheetsOut = sheets.map((sh) => ({
    id: sh.id,
    image: sheetFileName(sh.id),
    layer: sh.id === ALL_ID ? null : sh.id,
    first_frame: sh.first,
    frame_count: sh.count,
    start_ms: ms(sh.first),
    end_ms: ms(sh.first + sh.count),
    width: sh.layout.width,
    height: sh.layout.height,
    columns: sh.layout.columns,
    rows: sh.layout.rows,
    blocks: sh.layout.blocks,
  }));
  const layers = spriteLayers(template).map((l) => {
    const sheet = sheetsOut.find((x) => x.id === l.id) || null;
    const win = layerWindow(template, l);
    return {
      id: l.id,
      type: l.type,
      image: sheet?.image ?? null,
      first_frame: sheet?.first_frame ?? null,
      frame_count: sheet?.frame_count ?? 0,
      start_ms: sheet?.start_ms ?? null,
      end_ms: sheet?.end_ms ?? null,
      beats: l.beats || [],
      beat_window_ms: win ? [win.start, win.end] : null,
      blend: l.type === "decal" ? decalBlend(l) : l.blend || defaultBlend(l),
      color_slot: l.color || "primary",
      colors: colorHexes(template, l.color),
      z: l.z ?? 0,
      anchor: l.anchor || "target",
      attach_to: l.attach_to || null,
      // How it moves when the actor it sits on moves (engine/readability.js).
      tracking: trackingFor(l),
      tracking_source: l.tracking ? "template" : "default",
      plane: l.plane || DEFAULT_PLANE[l.type] || "volume",
      loop,
      // Columns of this layer's sheet that loop with the aura (end exclusive).
      loop_columns: loopRangeOut && sheet && layerLoop(template, win)
        ? { first: loopRangeOut.first_frame - sheet.first_frame, end: loopRangeOut.end_frame - sheet.first_frame }
        : null,
      params: resolveParams(l.params, seed, `${l.id}#0`),
      keyframes: l.keyframes || [],
      empty: !visible[l.id],
      ...shaderInfo(l, l.type === "decal" ? decalBlend(l) : l.blend || defaultBlend(l), style, resolveParams(l.params, seed, `${l.id}#0`)),
    };
  });
  const tracksOut = tracks || { screen_flashes: [], camera_shake: [], lights: [], sounds: [], sound_cues: [], sound_story: [] };
  const decals = buildDecals(template, seed, plan, style);
  const sixWay = buildSixWay(template, seed, style);
  const st = STYLES[style.id];
  return {
    format: FORMAT,
    how_to_use: HOW_TO_USE.join(" "),
    style: { id: style.id, label: st.label, about: st.about, look: st.look, source: style.from, notes: style.notes, unity: st.unity, godot: st.godot },
    build_order: buildOrder(template, layers),
    layer_toggles: layerToggles(template, buildOrder(template, layers)),
    generator: `SpellDirector ${version}`.trim(),
    template: { id: template.id, name: template.name, element: template.element, archetype: template.archetype, description: template.description || "" },
    seed,
    duration_ms: plan.duration,
    loop,
    loop_range: loopRangeOut,
    fps: plan.fps,
    frame_ms: r3(plan.frameMs),
    frame_count: plan.count,
    frame: { width: frame, height: frame },
    alpha: "straight",
    bloom_baked: !!bloom,
    pixel_origin: "top-left, y down",
    hero_view: template.views?.hero || "three_quarter",
    view_rows: viewOrder,
    views: Object.fromEntries(viewOrder.map((v, i) => [v, { row: i, ...views[v], reads: template.views?.reads?.[v] || "" }])),
    sheets: sheetsOut,
    layers,
    beats: (template.beats || []).map((b) => ({
      id: b.id,
      phase: b.phase,
      start_ms: b.start_ms,
      end_ms: b.end_ms,
      first_frame: frameAt(plan, b.start_ms),
      last_frame: Math.max(frameAt(plan, b.start_ms), Math.ceil(b.end_ms / plan.frameMs - 1e-9) - 1),
      curve: b.intensity?.shape || "linear",
      intent: b.intent || "",
    })),
    palette: template.palette || {},
    reactions: reactionsOut(template),
    readability: readabilityOut(template),
    tracking_kinds: TRACKING,
    // The caster's arm and hand movements (engine/gesture.js): the casting
    // animation, for the engine's caster.
    caster_gestures: template.space?.caster_gestures?.length ? template.space.caster_gestures : null,
    decals,
    six_way_smoke: sixWay,
    ...tracksOut,
  };
}

// The quality target: the distance the look is judged at, the must-read
// cues and the key frames (tools/range_guide.py measures them).
function readabilityOut(template) {
  const r = resolveReadability(template);
  return {
    reference_distance: r.reference_distance,
    reference_source: r.reference_source,
    view_distances: r.view_distances,
    must_read: r.must_read,
    key_frames: r.key_frames,
    authored: r.authored,
  };
}

// Who stands round the caster and how the characters react (warcries and
// other area spells): for the engine's hit reactions and animations.
function reactionsOut(template) {
  const t = template.space?.targets || {};
  const c = template.space?.caster_react;
  if (!t.react && !c && t.side !== "allies") return null;
  return { side: t.side === "allies" ? "allies" : "enemies", targets: t.react || null, caster: c || null };
}

// ------------------------------------------------------------ guide (Markdown)

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, rows) => [
  `| ${head.join(" | ")} |`,
  `|${head.map(() => "---").join("|")}|`,
  ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
].join("\n");
const frames = (first, count) => (count === 1 ? `${first}` : `${first}–${first + count - 1}`);

function curveSummary(values, plan) {
  let peak = 0;
  let at = 0;
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      at = i;
    }
  });
  const on = visibleRange(values.map((v) => v > 0.001));
  if (!on) return "never on";
  return `on frames ${on.first}–${on.last}, peak ${peak} at frame ${at} (${Math.round(at * plan.frameMs)} ms)`;
}

// The "Aura loop" section of the guide: how to play start-up, loop and end.
function auraGuideLines(m) {
  const L = m.loop_range;
  const lines = [
    "## Aura loop", "",
    "This spell is an aura: it starts up, then holds a **seamless loop** for as long as the aura lasts, then plays its end. Play it in three parts:", "",
    table(["Part", "Frames (whole spell)", "Time", "Play"], [
      ["Start-up", L.first_frame > 0 ? `0–${L.first_frame - 1}` : "none", `0–${L.start_ms} ms`, "once, when the aura is applied"],
      ["Loop", `${L.first_frame}–${L.end_frame - 1}`, `${L.start_ms}–${L.end_ms} ms`, "repeat while the aura lasts (frame " + L.end_frame + " looks the same as frame " + L.first_frame + ")"],
      ["End", L.end_frame <= m.frame_count - 1 ? `${L.end_frame}–${m.frame_count - 1}` : "none", `${L.end_ms}–${m.duration_ms} ms`, "once, when the aura is removed: finish the current loop pass (or jump at once) and play on from frame " + L.end_frame],
    ]), "",
    "Every layer that is on across the loop repeats exactly: its pulses, spins and flicker fit whole cycles into the loop and its particles are reborn every loop, so the jump from the last loop frame back to the first doesn't show. Layers that only play in the start-up or the end (a flash when it is cast, a burst when it ends) are one-shots.", "",
  ];
  const looping = (m.layers || []).filter((l) => l.loop_columns);
  if (looping.length) {
    lines.push("Loop columns in each layer's own sheet (end exclusive):", "");
    lines.push(table(["Layer", "Sheet", "Loop columns"], looping.map((l) => [l.id, l.image ? `\`${l.image}\`` : "", `${l.loop_columns.first}–${l.loop_columns.end - 1}`])), "");
  }
  if (!L.frame_exact) lines.push(`> The loop's ends don't fall exactly on frames at ${m.fps} fps, so the jump may stutter by part of a frame. Export at a frame rate that divides the loop.`, "");
  lines.push(
    "- **Unity**: split the sheet into three clips (start-up, loop with **Loop Time** on, end) and chain them in an Animator: start-up → loop (exit time 1), loop → end on a trigger such as `AuraEnd`. Particle systems rebuilt from the layers: **Looping** on, **Prewarm** on, duration = the loop length, and turn emission off at the end so the last particles finish.",
    "- **Godot 4**: give the AnimatedSprite2D/3D three animations (`start`, `loop` with looping on, `end`) and play `loop` from `animation_finished` after `start`; play `end` when the aura is removed. GPUParticles: **One Shot** off, **Preprocess** = one particle lifetime, **Lifetime** that divides the loop; set `emitting = false` at the end.",
    "- **Ground marks** (decals) on across the loop just stay on and keep turning or pulsing in the engine; fade them out with the end.",
    "- **Sound**: start the sustained cues when the loop starts and keep them looping; one-shots marked `in_loop` in the sound sheet repeat every loop.",
    "",
  );
  return lines;
}

// The guide's "Quality target" section: what must read, the key frames to
// check the rebuild against, and which layers move with the actors.
export function readabilityGuideLines(m) {
  const r = m.readability;
  if (!r) return [];
  const out = ["## Quality target", ""];
  out.push(`Judge the look from **${r.reference_distance} units** away (1 unit = one character height; from ${r.reference_source}), then check it still reads at ${r.view_distances.join(", ")} units. \`tools/range_guide.py ${m.template.id}\` measures how wide each part reads at those distances.`, "");
  if (r.must_read.length) {
    out.push("**Must read** (protect these when simplifying for performance or distance):", "");
    for (const c of r.must_read) out.push(`- **${c.cue}** (layers ${c.layers.map((x) => `\`${x}\``).join(", ")}${c.beat ? `, in beat \`${c.beat}\`` : ""}${c.at_ms != null ? ` at ${c.at_ms} ms` : ""})${c.why ? `: ${c.why}` : ""}`);
    out.push("");
  }
  out.push(`**Key frames**${r.key_frames[0]?.source === "derived" ? " (from the beats; the template doesn't name its own)" : ""}: compare the rebuild with the viewer at these moments.`, "");
  for (const k of r.key_frames) out.push(`- **${k.label}**, ${k.t_ms} ms${k.note ? `: ${k.note}` : ""}`);
  out.push("");
  const groups = Object.keys(TRACKING).map((kind) => [kind, m.layers.filter((l) => l.tracking === kind).map((l) => `\`${l.id}\``)]).filter(([, ids]) => ids.length);
  if (groups.length) {
    out.push("**When an actor moves** (pushed back, walking, dodging), layers either ride on it, leave their particles behind, or stay where they landed:", "");
    for (const [kind, ids] of groups) out.push(`- ${TRACKING[kind].label}: ${ids.join(", ")}. ${TRACKING[kind].unity}`);
    out.push("");
  }
  return out;
}

export function guideMarkdown(m, { files } = {}) {
  const plan = { frameMs: m.frame_ms };
  const fw = m.frame.width;
  const fh = m.frame.height;
  const viewList = Object.keys(m.views);
  const lines = [];
  const add = (...xs) => lines.push(...xs);

  add(`# ${m.template.name}: sprite sheets and assembly guide`, "");
  add(
    `${m.template.description}`.trim() ? `${m.template.description}` : "",
    "",
    `Exported from SpellDirector template \`${m.template.id}\` (${m.template.element} ${m.template.archetype}) with seed **${m.seed}**. The same template and seed always give the same frames; another seed gives a new variation of the same spell.`,
    "",
  );

  add(...referenceChecklistLines(m, m.reference_checklist || referenceChecklist(m)));
  add("## How to use this export", "");
  add(...HOW_TO_USE.map((x) => `> ${x}`).flatMap((x) => [x, ">"]).slice(0, -1), "");
  if (m.style) add(...styleGuideLines({ id: m.style.id, from: m.style.source, notes: m.style.notes }));
  add("## Build it one layer at a time", "");
  add(
    "Don't build the whole spell in one go. Build one layer, check it, then add the next. This works far better for a person and for an AI (Claude, GPT, ...), because each step is small enough to get right and to compare against the reference.",
    "",
    "After each step, crop that layer's cells and compare them with your render at the same moments and views: `python tools/sheet_cells.py contact <export folder> --sheet <layer>` (or the director's `look_at_sprite_sheet` tool). Fix it before moving on. Compare timing, footprint, motion and color, not exact pixels.",
    "",
    "### Give every layer an on/off switch",
    "",
    "Make each layer its own switchable part of the effect, named by its layer id (the JSON's `layer_toggles` lists them in build order). While building, switch on only the layer you are working on and compare it with its sheet; then switch on the layers before it and check they still read together. Keep the switches in the finished spell: soloing or muting a layer is how you tune it, debug it, or make a cheaper version later.",
    "",
    "- **Unity**: one prefab for the spell, one child GameObject per layer named after the layer id (its VFX Graph, Particle System, light or audio source inside). Give the root a component with a `bool` per layer (or a list of layer ids with an enabled flag) shown in the Inspector, plus Solo and All on buttons; the script that plays the timeline skips a layer whose switch is off. Setting the child inactive is the simplest switch.",
    "- **Godot**: one scene for the spell, one child node per layer named after the layer id, and an `@export` bool per layer on the root script (or toggle each child's `visible` / `emitting` / `playing`); the player skips layers that are off.",
    "- **Any engine**: the switches live on the spell, not in the art, so turning one off never changes another layer's timing.",
    "",
  );
  add(table(
    ["Step", "Stage", "Layer (switch)", "Sheet", "Plays", "Switch on"],
    m.build_order.map((st, i) => {
      const before = m.build_order.slice(0, i).flatMap((x) => (x.layer ? [x.layer] : []));
      const on = before.length ? `${st.layer || "these"} alone, then with ${before.length === 1 ? before[0] : `steps 1–${i}`}` : `${st.layer} alone`;
      return st.stage === "finish"
        ? [st.step, "finish", st.layers.length ? st.layers.join(", ") : "(none)", "`all.png`", "whole spell", "everything"]
        : [st.step, st.stage, `${st.layer} (${st.type})`, st.sheet ? `\`${st.sheet}\`` : "not drawn", st.plays_ms ? `${st.plays_ms[0]}–${st.plays_ms[1]} ms` : "", on];
    }),
  ), "");
  add(
    "- **core**: the hero shape that reads as the spell on its own. Get this right first.",
    "- **secondary**: glows, rings and crackle that support the core.",
    "- **particles**: sparks, spray and smoke.",
    "- **decals**: marks on the ground.",
    "- **finish**: lights, screen flashes, camera shake and sound cues, then a timing pass: play the whole spell next to `all.png` frame by frame through each beat.",
    "",
  );

  add("Each layer below has a **Shader intent** line and short Unity and Godot recipes built from it. The words come from the SpellDirector vocabulary (docs/vocabulary.md, section 11), so a person or an AI can turn them into a Shader Graph, VFX Graph or Godot shader.", "");

  const nViews = viewList.length;
  const all = m.sheets.find((x) => x.id === ALL_ID);
  add("## At a glance", "");
  add(table(["", ""], [
    ["Length", `${m.duration_ms} ms, ${m.loop_range ? `an aura: start-up, a seamless loop (frames ${m.loop_range.first_frame}–${m.loop_range.end_frame - 1}, ${m.loop_range.start_ms}–${m.loop_range.end_ms} ms) held while it lasts, then its end` : m.loop ? "loops" : "plays once (one-shot)"}`],
    ["Frame rate", `${m.fps} fps (one frame every ${m.frame_ms} ms)`],
    ["Frames", `${m.frame_count} for the whole spell (frame 0 is 0 ms)`],
    ["Cell size", `${fw} × ${fh} px`],
    ["Sheets", `${m.sheets.length}: \`${all?.image ?? "all.png"}\` for the whole spell, plus one per layer`],
    ["Rows in every sheet", viewList.map((v, i) => `${i} ${VIEW_NAMES[v] || v}${v === m.hero_view ? " (hero)" : ""}`).join(", ")],
    ["Alpha", "Straight (not premultiplied), transparent background"],
    ["Bloom", m.bloom_baked ? "Baked into the sprites (the soft glow around bright parts). Turn your engine's bloom down on these, or export without bloom." : "Not baked in: add bloom in your engine for the glow"],
  ]), "");

  if (m.loop_range) add(...auraGuideLines(m));

  add("## Files", "");
  const fileRows = m.sheets.map((sh) => [`\`${sh.image}\``, sh.id === ALL_ID ? "The whole spell, every layer together" : `Layer \`${sh.id}\``]);
  for (const f of files || []) fileRows.push([`\`${f.name}\``, f.about]);
  for (const d of m.decals || []) {
    fileRows.push([`\`${d.texture}\``, `Top-down texture of decal \`${d.layer}\` for a decal projector`]);
    if (d.height_map) fileRows.push([`\`${d.height_map}\``, `Height map of decal \`${d.layer}\` for parallax (${d.depth < 0 ? "black = ground, white = highest" : "white = ground, black = deepest"})`]);
    if (d.emissive_mask) fileRows.push([`\`${d.emissive_mask}\``, `Where decal \`${d.layer}\`'s ${d.fill} fill sits (white = fill)`]);
    if (d.flow_map) fileRows.push([`\`${d.flow_map}\``, `Flow map for decal \`${d.layer}\`'s ${d.fill} (RG = direction, outward from the centre)`]);
  }
  for (const w of m.six_way_smoke || []) {
    fileRows.push([`\`${w.positive_map}\``, `Six-way lightmap flipbook of smoke \`${w.layer}\`, positive axes (R right, G top, B back, A alpha)`]);
    fileRows.push([`\`${w.negative_map}\``, `Six-way lightmap flipbook of smoke \`${w.layer}\`, negative axes (R left, G bottom, B front, A emissive)`]);
  }
  add(table(["File", "What it is"], fileRows), "");

  add("## How the sheets are laid out", "");
  add(
    "There is one sheet per layer, plus `all.png` with every layer together (use that one alone if you don't need separate layers).",
    "",
    "- **Columns are frames.** A layer's sheet holds only the frames where that layer shows. Column 0 is the layer's first frame, at its start time.",
    `- **Rows are views**, always in this order: ${viewList.map((v, i) => `row ${i} ${VIEW_NAMES[v] || v}`).join(", ")}. So one column holds every view of the same moment.`,
    "- **Everything lines up.** Every cell is the same size, and a view uses the same camera in every sheet. Put all the layer sprites of one view at the same position and they stack into the full spell, pixel for pixel.",
    `- A sheet with more frames than its \`columns\` wraps: the next frames go in a new block of ${nViews} view rows underneath. Frame \`k\` of a sheet, for the view in row \`v\`, is at column \`k % columns\` and row \`floor(k / columns) × ${nViews} + v\`. Its pixel rect is \`x = column × ${fw}\`, \`y = row × ${fh}\`, size ${fw} × ${fh}, from the top-left.`,
    "- At spell frame `f`, a layer shows its sheet's frame `k = f - first_frame` while `0 <= k < frame_count`, and nothing otherwise.",
    "- The table is in draw order, back to front (lowest `z` first).",
    "",
  );
  add(table(
    ["Sheet", "Layer", "Type", "Frames", "Spell frames", "Plays", "Columns × rows", "Size (px)", "Blend", "z"],
    m.sheets.map((sh) => {
      const l = m.layers.find((x) => x.id === sh.id);
      return [
        `\`${sh.image}\``,
        sh.id === ALL_ID ? "**whole spell**" : sh.id,
        l?.type ?? "all layers",
        sh.frame_count,
        frames(sh.first_frame, sh.frame_count),
        `${sh.start_ms}–${sh.end_ms} ms`,
        `${sh.columns} × ${sh.rows}`,
        `${sh.width} × ${sh.height}`,
        l ? l.blend : "alpha",
        l ? l.z : "",
      ];
    }),
  ), "");
  const big = m.sheets.filter((sh) => Math.max(sh.width, sh.height) > 4096);
  if (big.length) add(`Some sheets are wider or taller than 4096 px (${big.map((x) => `\`${x.image}\``).join(", ")}). Desktop engines handle that if you raise the texture's max size, but some phones cap textures at 4096. Export with a smaller cell size or frame rate if that matters.`, "");
  const empty = m.layers.filter((l) => l.empty);
  if (empty.length) add(`Not visible in any exported view, so no sheet: ${empty.map((l) => `\`${l.id}\``).join(", ")}.`, "");

  add(...readabilityGuideLines(m));
  add("## Timeline (beats)", "");
  add("Beats are the phases of the spell. Layers switch on and off with them.", "");
  add(table(
    ["Beat", "Phase", "Time", "Frames", "Intensity curve", "What should happen"],
    m.beats.map((b) => [b.id, b.phase, `${b.start_ms}–${b.end_ms} ms`, `${b.first_frame}–${b.last_frame}`, b.curve, b.intent]),
  ), "");

  add("## Layers", "");
  for (const l of m.layers) {
    add(`### ${l.id} (${l.type})`, "");
    const bits = [
      l.image ? `Sheet \`${l.image}\`: ${l.frame_count} frames, plays ${l.start_ms}–${l.end_ms} ms (spell frames ${frames(l.first_frame, l.frame_count)}).` : "Not visible in the exported views.",
      `Active in beats: ${l.beats.join(", ") || "none"}${l.beat_window_ms ? ` (${l.beat_window_ms[0]}–${l.beat_window_ms[1]} ms; it may linger a little after as it fades)` : ""}.`,
      `Blend: **${l.blend}**${l.blend === "add" ? " (additive: use an additive material in the engine)" : l.blend === "multiply" ? " (darkens what is behind it)" : " (normal alpha blending)"}. Draw order z = ${l.z}.`,
      `Color: \`${l.color_slot}\` ${l.colors.join(" → ")}.`,
      `Sits at: ${l.anchor}${l.attach_to ? `, follows \`${l.attach_to}\`` : ""}; plane ${l.plane}. ${l.loop ? "Loops with the spell." : "One-shot."}`,
    ];
    if (l.tracking) {
      const k = TRACKING[l.tracking];
      bits.push(`When the actor moves: **${k.label}**${l.tracking_source === "default" ? " (default for this layer type)" : ""}. Unity: ${k.unity} Godot 4: ${k.godot}`);
    }
    add(...bits.map((b) => `- ${b}`));
    const params = Object.entries(l.params || {});
    if (params.length) add(`- Settings for this seed: ${params.map(([k, v]) => `${k} ${typeof v === "number" ? r3(v) : v}`).join(", ")}.`);
    if (l.render) add(`- How we drew it (code, materials, shaders): \`${l.render}\`.`);
    if (l.keyframes?.length) add(`- Keyframes (already baked into the frames): ${l.keyframes.map((k) => `${k.param} → ${k.value} at ${k.t_ms} ms`).join("; ")}.`);
    if (l.shader) {
      add(`- **Shader intent**${l.shader_source.startsWith("template") ? "" : " (a default for this layer type; the template didn't say)"}: ${describeShader(l.shader)}.`);
      if (l.shader.look) add(`- Look: ${l.shader.look}`);
      if (l.shader.notes) add(`- Notes: ${l.shader.notes}`);
      if (l.engine_hints) {
        add(`- Unity: ${l.engine_hints.unity.join(" ")}`);
        add(`- Godot 4: ${l.engine_hints.godot.join(" ")}`);
      }
    }
    add("");
  }

  if (m.decals?.length) {
    add("## Decals (marks on the ground)", "");
    add(
      "Decal layers are marks on the ground: scorch, cracks, puddles, frost, rune circles, warning rings. Each one is exported twice: like any layer, in its sheet (use that in a 2D game), and as a **top-down texture plus a timing curve** for a 3D engine's decal projector, which lays the mark on whatever ground is there, slopes and all.",
      "",
    );
    add(table(
      ["Decal", "Shape", "Blend", "Texture", "Size on the ground", "Fade in", "Full until", "Fade out", "Rotation"],
      m.decals.map((d) => [
        d.layer, d.shape, d.blend === "add" ? "add (glows)" : d.blend, `\`${d.texture}\``,
        `${d.size_units}${d.stretch !== 1 ? ` × ${r3(d.size_units * d.stretch)} (stretched)` : ""} units${d.grow_ms ? `, grows from ${d.start_scale}× over ${d.grow_ms} ms` : ""}`,
        `${d.start_ms}–${r1(d.start_ms + d.fade_in_ms)} ms`, `${d.hold_until_ms} ms`, `${d.fade_out_ms} ms, gone at ${d.end_ms} ms${d.outlives_spell ? " (after the spell ends)" : ""}`,
        `${d.rotation_deg}°${d.spin_deg_per_s ? `, spins ${d.spin_deg_per_s}°/s` : ""}`,
      ]),
    ), "");
    add(
      `- **The texture** is ${m.decals[0].texture_px} × ${m.decals[0].texture_px} px, seen from straight above, straight alpha, with the palette color already in it. Its right edge points along the cast direction (caster to target) and its top edge to the caster's left, exactly as it looks in the Top view. The mark fills the middle 92% of the image.`,
      "- **Size** is the texture's full width in world units, where 1 unit is one character height; multiply by your character's height. A stretched decal is wider along its rotation axis.",
      "- **Rotation** is counter-clockwise as seen from above, starting from the cast direction. Without a fixed rotation in the template, each seed lays the mark at a different angle.",
      "- **Timing**: it fades in from its start, stays until *full until*, then fades out. A mark that outlives the spell is meant to stay on the ground: keep the projector alive until its end time. `pulse_hz` (warning rings) makes its opacity throb.",
      "- **Curves** in the JSON (`decals[].curves`) give opacity (0–1), scale (× full size) and rotation (degrees) for every spell frame, already including fades, growth, spin and pulse. Read them, or rebuild them from the timing fields.",
      "- **Arc and reveal**: a decal with `arc_deg` under 360 is only the sector facing the cast direction (already cut out in the texture). One with `reveal_ms` spreads out from its centre, like cracks running across the ground: the `reveal` curve (0–1) is how far out it has spread, as a fraction of the texture's half-width. In a shader, hide pixels whose distance from the texture centre (0 at the centre, 1 at the edge's midpoint) is beyond `reveal`, with a soft edge.",
      "- **Per target**: a decal marked `per_target` repeats on every chain target, delayed by each hop, or (anchor `splash`) on every enemy around the primary target, delayed as the splash ripples out.",
      "- **Blend**: `alpha` decals paint the ground (scorch darkens it, puddles tint it). `add` decals are light on the ground (glowing cracks, rune circles, warning rings): use emission, not albedo.",
      "",
    );
    const deep = m.decals.filter((d) => d.height_map || d.fill !== "none");
    if (deep.length) {
      add("### Depth and fills", "");
      add(table(
        ["Decal", "Depth", "Fill", "Fill colors", "Maps"],
        deep.map((d) => [
          d.layer,
          d.depth ? `${d.depth < 0 ? "raised" : "carved"} ${Math.abs(d.depth)}` : "flat",
          d.fill === "none" ? "none" : `${d.fill}: ${DECAL_FILLS[d.fill].about}${d.fill_in_ms ? `; rises over ${d.fill_in_ms} ms` : ""}`,
          d.fill_colors ? d.fill_colors.join(" → ") : "",
          [d.height_map, d.emissive_mask, d.flow_map].filter(Boolean).map((x) => `\`${x}\``).join(", "),
        ]),
      ), "");
      add(
        "- **Depth** makes the mark look cut into the ground (cracks that open up, a crater with a real dent) instead of painted on. Use the height map with parallax occlusion mapping (Unity: Parallax Occlusion Mapping node in a decal Shader Graph; Godot: a ground quad with Heightmap / Deep Parallax) and derive a normal from it so the walls catch the light. The viewer's Realistic style shows the effect.",
        "- **Fill** is what sits in the bottom of the mark. Multiply the emissive mask by a flowing noise (scroll it along the flow map for lava) and drive it from the `fill` curve (0–1: how far it has risen) and the `heat` curve (1 = fresh, 0 = cooled: lerp lava to a dark crust, fade glow out).",
        "",
      );
    }
    add(
      "**Unity (URP or HDRP Decal Projector).** URP: add the **Decal** renderer feature to your URP Renderer asset first.",
      "",
      "1. Import the decal PNG with **Alpha Is Transparency** on, **Wrap Mode: Clamp**.",
      "2. Make a material with **Shader Graphs/Decal** (URP) or **HDRP/Decal**. For `alpha` decals put the texture in **Base Map**; for `add` decals put it in the **Emissive** map (HDRP: enable Affect Emission; URP: a decal Shader Graph that outputs Emission) and set the base alpha to 0.",
      "3. Add a **Decal Projector** at the decal's anchor (usually the target), rotated to point down (X = 90). Set **Width** to `size_units × stretch × character height`, **Height** to `size_units × character height`, **Projection Depth** about 0.5 units. Turn it about the world up axis by `rotation_deg` (plus however your texture's right edge maps to your cast direction).",
      "4. Each frame, set the projector's **Fade Factor** (`fadeFactor`) from the `opacity` curve, scale width and height by the `scale` curve, and set the up-axis angle from the `rotation_deg` curve. Destroy it at `end_ms`.",
      "",
      "**Godot 4 (Decal node).**",
      "",
      "1. Add a **Decal** node at the anchor. A Decal projects down its -Y axis, so it lays on the ground as is.",
      "2. **Size** = `(size_units × stretch × character height, about 0.5, size_units × character height)`. Rotate it about Y by `rotation_deg`.",
      "3. `alpha` decals: set **Textures → Albedo** to the PNG. `add` decals: set **Textures → Emission** to the PNG and raise **Emission Energy**; leave Albedo empty or set **Albedo Mix** to 0.",
      "4. Each frame, set **Modulate** alpha from the `opacity` curve, multiply Size by the `scale` curve, and set the Y rotation from `rotation_deg`. Free it at `end_ms`.",
      "",
      "**2D engines.** Use the decal layer's sheet in your view's row, or draw the texture as a sprite under the characters (top-down games), squashed vertically into an ellipse for a 3/4 camera. Drive its alpha, scale and rotation from the same curves.",
      "",
    );
  }

  if ((m.six_way_smoke || []).length) add(...sixWayGuideLines(m.six_way_smoke), "");

  const volumetric = m.layers.filter((l) => l.shader?.volumetric);
  if (volumetric.length) add(...volumetricGuideLines(volumetric), "");

  add("## Not in the sheets: flashes, shake, lights and sound", "");
  add("These are better done by the engine than baked into pixels. Their per-frame curves are in the JSON file (one value per spell frame).", "");
  if (m.screen_flashes.length) {
    add("### Screen flashes", "");
    add(table(["Layer", "Mode", "Color", "When"], m.screen_flashes.map((f) => [f.layer, f.mode === "multiply" ? "darken (multiply)" : "brighten (add/screen)", f.color, curveSummary(f.opacity, plan)])), "");
    add("Draw a full-screen quad (or UI image) in that color and set its opacity from the `opacity` curve each frame.", "");
  }
  if (m.camera_shake.length) {
    add("### Camera shake", "");
    add(table(["Layer", "Frequency", "When"], m.camera_shake.map((s) => [s.layer, `${s.frequency_hz} Hz`, curveSummary(s.amplitude_px, plan)])), "");
    add("`amplitude_px` is the peak offset in template pixels, where 100 px is one character height. Each frame, offset the camera by a random amount up to that much, picking a new offset `frequency_hz` times a second. The sprite frames do not include the shake.", "");
  }
  if (m.lights.length) {
    add("### Lights", "");
    add(table(["Layer", "At", "Offset (x, y, z units)", "Color", "Range", "When"], m.lights.map((l) => [l.layer, l.anchor, `${(l.offset_units || [0, 0.8, 0]).join(", ")}${l.orbit_hz ? `, orbiting ${l.orbit_hz} turns/s` : ""}`, l.color, `${l.radius_units} units`, curveSummary(l.energy, plan)])), "");
    add("Add a point light at its anchor plus the offset (x along the cast direction, y up, z to its right; an orbiting light circles the anchor at that distance, counter-clockwise from above) and set its intensity from the `energy` curve to light up the scene around the spell.", "");
  }
  if (m.sounds.length) add("Sound has its own section below: [Sound](#sound).", "");
  if (!m.screen_flashes.length && !m.camera_shake.length && !m.lights.length && !m.sounds.length) add("None for this spell.", "");

  if (m.sounds.length) add(...soundGuide(m), "");

  add("## Placing it in the scene", "");
  add(
    "One world unit is one character height. Each view's cells are framed on the whole spell, so the caster and target are at the same pixels in every frame and every sheet of that view. Line those up with your characters, then scale so that the `px_per_unit` below matches your character's height on screen.",
    "",
  );
  add(table(
    ["View", "Caster (feet) px", "Target (feet) px", "Pixels per unit at the target", "What the player should see"],
    viewList.map((v) => {
      const info = m.views[v];
      const xy = (p) => (p ? `${p[0]}, ${p[1]}` : "n/a");
      return [VIEW_NAMES[v] || v, xy(info.pivots?.caster), xy(info.pivots?.target), info.px_per_unit ?? "", info.reads];
    }),
  ), "");
  add("Pixel positions are from the top-left of a cell and can fall outside it (the caster is often off to the side). Front, side and 3/4 are perspective cameras; top is a straight-down orthographic camera.", "");

  if (m.reactions) {
    const r = m.reactions;
    const n = (v) => (v && typeof v === "object" ? `${v.min}–${v.max}` : v);
    const say = (x) => `\`${x.kind}\` from ${n(x.at_ms ?? 0)} ms${x.duration_ms ? ` for ${n(x.duration_ms)} ms` : ""}`;
    add("## Character reactions", "");
    add(`The characters round the caster are **${r.side}**. The viewer poses its stand-ins to show how your characters should move; play these as hit reactions or animations on your own characters (they are not in the sheets).`, "");
    if (r.caster) add(`- **Caster**: ${say(r.caster)} (\`shout\`: rear back drawing breath, then throw the chest forward with the shout about 40% in).`);
    if (r.targets) add(`- **Each ${r.side === "allies" ? "ally" : "enemy"}**: ${say(r.targets)}, plus their own per-target delay (the same delay as the layers marked per target), pushed and leaning away from the caster.`);
    add("");
  }

  if (m.caster_gestures) {
    const n = (v) => (v && typeof v === "object" ? `${v.min}–${v.max}` : v);
    add("## Casting animation", "");
    add("The viewer moves the caster's arms and hands with these gestures; play matching animations on your caster. Each gesture's last pose lands at its start plus its duration (a throw's release), holds, then eases back to rest. The effect leaves the hand at those moments.", "");
    add(table(["Gesture", "Hand", "Starts (ms)", "Lands (ms)", "Holds (ms)"], m.caster_gestures.map((g) => {
      const at = n(g.at_ms ?? 0);
      const lands = typeof g.at_ms === "object" || typeof g.duration_ms === "object" ? "" : g.duration_ms != null ? (g.at_ms ?? 0) + g.duration_ms : "";
      return [`\`${g.kind}\`${g.shape ? ` (${g.shape})` : ""}`, g.hand || "lead", at, lands, n(g.hold_ms ?? 250)];
    })), "");
  }

  if (m.render?.layers?.length) {
    add("## How we rendered it (code and shaders)", "");
    add(
      `Each layer has a \`render/<layer>.md\` with the code SpellDirector's viewer used to draw it (${m.render.engine}): the layer class and every helper it calls, the objects and materials it made at its strongest frame, each material's blend and depth state written as Unity ShaderLab, the uniforms, and the GLSL of every custom shader. \`${m.render.porting}\` maps all of it to Unity (HLSL, Shader Graph, VFX Graph) and Godot.`,
      "",
      "Use it as a recipe for your own shaders and particles, one layer at a time: read the layer's notes, build it, then compare it with its sheet.",
      "",
    );
    add(table(["Layer", "Drawn with", "Notes"], m.render.layers.map((r) => [`${r.id} (${r.type})`, r.summary, `\`${r.file}\``])), "");
  }

  add("## Rebuild it in Unity", "");
  add(
    "Pick the view your game uses (say 3/4, row 3). Everything below uses only that row of each sheet.",
    "",
    "1. Import each layer's PNG. In the import settings set **Texture Type: Sprite (2D and UI)**, **Sprite Mode: Multiple**, **Alpha Is Transparency: on**, **Compression: None** (or high quality), **Filter: Bilinear**, and raise **Max Size** to at least the sheet's larger side.",
    `2. Open the **Sprite Editor**, choose **Slice → Grid By Cell Size**, ${fw} × ${fh}, and apply. Sprites are numbered left to right, top to bottom, so for view row \`v\` frame \`k\` is sprite \`(floor(k / columns) × ${nViews} + v) × columns + k % columns\`.`,
    "3. Make an empty GameObject for the spell (at the target, see *Placing it in the scene*). For each layer add a child with a **SpriteRenderer**, all at the same local position. Set **Order in Layer** from the layer's z.",
    "4. Materials: layers with blend **add** get an additive material (URP: *Sprite-Unlit* or *Particles/Unlit* with **Blending Mode: Additive**; built-in: *Legacy Shaders/Particles/Additive*). **alpha** layers use the default sprite material; **multiply** layers use a multiply particle material.",
    `5. Animate: either make an Animation Clip per layer at ${m.fps} samples with that view's frames, starting at the layer's start time; or use a small script that each frame computes \`k = floor((time - start_ms / 1000) × ${m.fps})\` and shows frame \`k\` while \`0 <= k < frame_count\`, hiding the renderer otherwise.`,
    "6. Read the JSON for screen flashes (a full-screen UI Image), camera shake (Cinemachine Impulse or a script), lights (a Point Light / Light2D with intensity from `energy`) and sounds (`AudioSource.PlayOneShot` at `at_ms`, or a looping source for sustained cues).",
    `7. For a quick version, use only \`all.png\` with a normal sprite material${m.layers.some((l) => l.blend === "add") ? " (or additive, which looks closer on dark scenes)" : ""}.`,
    "",
  );

  add("## Rebuild it in Godot 4", "");
  add(
    "1. Import each layer's PNG (keep **Compress → Mode: Lossless**).",
    `2. For each layer add an **AnimatedSprite2D** (or **AnimatedSprite3D** in 3D). Create **SpriteFrames**, use **Add frames from sprite sheet**, set the grid to that sheet's columns × rows (cell ${fw} × ${fh}), and pick the cells of your view's row. Set the speed to ${m.fps} FPS and looping ${m.loop ? "on" : "off"}.`,
    "3. Put all layer nodes under one parent at the same position. Order them by z (later children draw on top, or set **Z Index**).",
    "4. Blend: for **add** layers give the node a **CanvasItemMaterial** with **Blend Mode: Add** (3D: unshaded StandardMaterial3D with **Blend Mode: Add**). **multiply** layers use **Blend Mode: Multiply**.",
    "5. Start each layer at its start time: an **AnimationPlayer** track that calls `play()` at `start_ms`, or set `visible` and `frame` from a script each frame like the Unity example.",
    "6. From the JSON: screen flashes as a full-screen **ColorRect** on a CanvasLayer, shake by offsetting the **Camera2D/Camera3D**, lights as **PointLight2D/OmniLight3D**, and sounds as **AudioStreamPlayer** calls at `at_ms`.",
    "",
  );

  add("## Reading the sheets as an AI model (Claude, GPT, ...)", "");
  const exView = m.view_rows.includes(m.hero_view) ? m.hero_view : m.view_rows[0];
  const exSheet = m.sheets.find((x) => x.id !== ALL_ID && x.frame_count > 1) || m.sheets[0];
  const exK = Math.min(exSheet.frame_count - 1, Math.floor(exSheet.frame_count / 2));
  const exF = exSheet.first_frame + exK;
  const exV = m.view_rows.indexOf(exView);
  const exCol = exK % exSheet.columns;
  const exRow = Math.floor(exK / exSheet.columns) * nViews + exV;
  add(
    "First, the rules from the top of this guide: use every reference, and treat the sheets as a timing and composition reference, not literal instructions. Look at cells to understand when and where each layer happens and how it reads, in every view, not only the hero view; build the actual look from each layer's shader intent and render notes.",
    "",
    "The sheets have no numbers or gridlines drawn on them, so the engine gets clean pixels. The JSON file is the map. Don't try to read a whole sheet as one image: it gets scaled down, the cells blur together and you can't tell which column is which frame. Instead, use the map to cut out the cells you need and look at those.",
    "",
    "**The grid, for every sheet in this export:**",
    "",
    `- Cells are ${fw} × ${fh} px. Pixel (0, 0) is the top-left corner of the sheet, y goes down.`,
    `- Spell frame \`f\` is at time \`f × ${m.frame_ms}\` ms. Frame 0 is 0 ms; the last frame is ${m.frame_count - 1}.`,
    `- View rows: ${m.view_rows.map((v, i) => `\`${v}\` = ${i}`).join(", ")}.`,
    "- For a sheet `s` from `sheets` in the JSON, a view row `v` and a spell frame `f`:",
    "  1. `k = f - s.first_frame`. If `k < 0` or `k >= s.frame_count`, that layer isn't drawn at frame `f` (nothing to crop).",
    "  2. `column = k % s.columns`, `row = floor(k / s.columns) × " + nViews + " + v`.",
    `  3. The cell is the rectangle \`x = column × ${fw}\`, \`y = row × ${fh}\`, width ${fw}, height ${fh}.`,
    "",
    `**Worked example:** layer \`${exSheet.id}\` (\`${exSheet.image}\`, first_frame ${exSheet.first_frame}, ${exSheet.columns} columns), view \`${exView}\` (row ${exV}), spell frame ${exF} (${Math.round(exF * m.frame_ms)} ms): k = ${exF} - ${exSheet.first_frame} = ${exK}, column = ${exCol}, row = ${exRow}, so the cell is x ${exCol * fw}, y ${exRow * fh}, ${fw} × ${fh}.`,
    "",
    "**Transparent background:** the cells are mostly transparent, and additive layers are light on nothing. Paste a cell onto a dark background (for example #181B24) before looking at it, or it may look empty.",
    "",
    "**Tools in the SpellDirector repo** (Pillow only). They write labeled PNGs to an `ai/` folder next to the sheets and print the path:",
    "",
    "```bash",
    `python tools/sheet_cells.py cell    <export folder> --sheet ${exSheet.id} --view ${exView} --frame ${exF}`,
    `python tools/sheet_cells.py frame   <export folder> --frame ${exF} --layers   # one moment, every view, every layer`,
    `python tools/sheet_cells.py contact <export folder> --sheet ${exSheet.id}       # a whole sheet, each cell tagged with frame, ms and view`,
    "python tools/sheet_cells.py labeled <export folder>   # <sheet>_labeled.png copies with gridlines and labels",
    "python tools/sheet_cells.py map     <export folder>   # every cell's rectangle as text",
    "```",
    "",
    "Through the SpellDirector MCP server the same thing is the `look_at_sprite_sheet` tool, which returns the image directly.",
    "",
    "**Without the repo**, crop with any image library. In Python:",
    "",
    "```python",
    "import json, math",
    "from PIL import Image",
    `m = json.load(open("${m.template.id}.spritesheet.json"))`,
    "def cell(sheet_id, view, f):",
    '    s = next(x for x in m["sheets"] if x["id"] == sheet_id)',
    '    k = f - s["first_frame"]',
    '    if not 0 <= k < s["frame_count"]:',
    "        return None  # not drawn at this frame",
    '    w, h = m["frame"]["width"], m["frame"]["height"]',
    '    col, row = k % s["columns"], (k // s["columns"]) * len(m["view_rows"]) + m["view_rows"].index(view)',
    '    img = Image.open(s["image"]).convert("RGBA").crop((col * w, row * h, col * w + w, row * h + h))',
    '    bg = Image.new("RGBA", img.size, (24, 27, 36, 255))',
    "    bg.alpha_composite(img)",
    "    return bg",
    `cell("${exSheet.id}", "${exView}", ${exF}).save("check.png")`,
    "```",
    "",
    "A good review order: the `all` sheet's contact sheet for the overall timing, then one frame across every layer at the peak of each beat (the beat table gives the frames), then single cells where something looks off.",
    "",
  );

  if (m.caster_rig) add(...rigGuideLines(m));

  add("## Machine-readable data", "");
  add(
    `The JSON file has everything above in format \`${m.format}\`: \`sheets\` (image, first_frame, frame_count, start_ms, end_ms, columns, rows), \`view_rows\` and \`views\` (row, pivots, px_per_unit), \`layers\` (blend, colors, z, anchor, params for this seed), \`beats\`, \`decals\` (texture, size, timing and per-frame opacity, scale and rotation), \`screen_flashes\`, \`camera_shake\`, \`lights\` and \`sounds\`. Curves have one value per spell frame. An importer script can build the whole effect from it.`,
    "",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ------------------------------------------------------------ caster rig guide

// The guide's caster rig section (engine/rigexport.js): the animation, the
// sockets the effects hang from, and how to set it up in Unity.
export function rigGuideLines(m) {
  const r = m.caster_rig;
  const lines = [
    "## Caster rig and animation (Unity Humanoid)",
    "",
    `The caster's skeleton uses **Mixamo bone names** (\`mixamorig:Hips\`, \`mixamorig:LeftArm\`, \`mixamorig:LeftHandIndex1\`...), and its casting animation (${r.driven_by === "gestures" ? "from the template's gestures" : `from the clip \`${r.driven_by.replace(/^clip: /, "")}\``}) is baked at ${m.fps} fps. Unity maps those names to a Humanoid avatar automatically, so the animation plays on any Humanoid character: a Mixamo character, or your own.`,
    "",
    table(["File", "What it is"], [
      [`\`${r.glb}\``, "The caster: skeleton (T-pose rest), a crude stick mesh, socket nodes where effects attach (`socket_caster_hand`...), the spell's world points (`point_target_0`...) and the animation. Meters, the caster facing +Z."],
      [`\`${r.timeline}\``, "Format `spelldirector.timeline/1`: every gesture, beat, layer, light, flash and sound as an event at `t_ms`, each tied to a socket on the bones or to a world point, plus every socket's position per frame (`socket_tracks`)."],
      [`\`${r.clip}\``, "The same animation as a SpellDirector clip (`spelldirector.clip/1`), to play it again in SpellDirector."],
    ]),
    "",
    "### Set it up in Unity",
    "",
    `1. Get the rig in as FBX (the most reliable route to a Humanoid): in Blender, run \`blender -b -P tools/blender_glb_to_fbx.py -- ${r.glb} ${r.glb.replace(/\.glb$/, ".fbx")}\`. (Or install the glTFast package and import the .glb directly; set its animation import to Mecanim.)`,
    "2. Select the FBX. **Rig** tab: Animation Type **Humanoid**, Avatar Definition **Create From This Model**, Apply. The mixamorig bones map on their own.",
    "3. **Animation** tab: the clip is named after the spell. Untick Loop Time for a one-shot. Leave Root Transform Rotation and Position baked into pose (the caster casts in place).",
    "4. Put the clip in your caster's Animator (a Cast state, or an Animator Override Controller), and trigger it when the spell is cast. Any Humanoid character can play it.",
    "5. Add an empty child under the matching bone of *your* character for each socket in the timeline (`caster_hand` sits on `mixamorig:LeftHand` at `offset_m`), or use `Animator.GetBoneTransform(HumanBodyBones.LeftHand)` and add the offset.",
    "6. Drive the effects from the timeline's events: at `t_ms` spawn the layer (VFX Graph, Particle System or Shuriken) at its socket (parent it so it follows the hand) or at its world point, and stop it at `end_ms`. Animation Events on the clip, a Timeline asset or a coroutine all work; `release_ms` on a gesture is the moment a throw lets go.",
    "7. Build the layers one at a time (see *Build it one layer at a time*): each layer is a child object with its own on/off switch, and the driver skips any event whose `toggle` is switched off. Get the animation and the first layer right together before adding the next.",
    "",
    "**Which hand:** the casting hand (SpellDirector's lead hand, `caster_hand`) is the caster's **left** hand. For a right-handed caster, tick **Mirror** on the clip and swap Left and Right in the socket bones.",
    "",
    "**Coordinates:** the GLB and the timeline are in glTF space (meters, +Y up, the caster at the origin facing +Z, +X its left). Unity's importers flip x, so a Unity position is (-x, y, z); the timeline gives `unity_position_m` for the world points. One SpellDirector unit (a character's height) is 1.8 m.",
    "",
  ];
  return lines;
}

// ------------------------------------------------------------ sound guide

export const soundSheetName = (id) => `${id}.sounds.json`;
export const soundPreviewName = (id) => `${id}.preview.wav`;

const db = (x) => (x <= -96 ? "silent" : `${x > 0 ? "+" : ""}${x} dB`);

// The guide's Sound section: what plays when, what each sound should be, and
// how to make the real ones. Wording rules are in docs/sound-design.md.
export function soundGuide(m) {
  const id = m.template.id;
  const out = [];
  const add = (...xs) => out.push(...xs);
  const cues = m.sound_cues || [];
  add("## Sound", "");
  const rendered = (m.sound_files || []).length > 0;
  if (!rendered) {
    add("This export has no sound files (they were turned off, or this browser can't render audio offline). Everything needed to make them is below.", "");
  } else add(
    `This export has sound files too: \`${soundPreviewName(id)}\` is the whole spell's mix (it starts at 0 ms, frame 0: play it under \`all.png\` to check timing), and there is one \`sound-<cue>.wav\` per cue below, each peak-normalized to -1 dBFS. **They are SpellDirector's procedural placeholders**: the timing and rough character are right, the quality is not final. Replace each one with a real sound under the same file name; the engine wiring stays the same.`,
    "",
  );
  add(
    `\`${soundSheetName(id)}\` has all of this in machine-readable form (format \`spelldirector-sounds-1\`): the cue list with prompts and recipes, and every event with its time, frame, file, volume and pitch.`,
    "",
  );
  if (m.sound_story?.length) {
    add("**The sound of this spell, beat by beat:**", "", ...m.sound_story.map((x) => `- ${x}`), "");
  }
  add(table(
    ["At", "Frame", "Sound file", "Role", "Kind", "Length", "Volume", "Pitch", "Layer"],
    m.sounds.map((s) => [
      `${s.at_ms} ms`, s.frame ?? "", s.file ? `\`${s.file}\`` : `${s.cue} (no file)`, [s.role, s.beat].filter(Boolean).join(", "),
      s.loop ? "sustained: loop until it ends" : "one-shot", `${s.duration_ms} ms`, db(s.volume_db), s.pitch, s.layer,
    ]),
  ), "");
  add("Volume is relative to each file's own peak (0 dB = as is). Pitch is a playback-rate multiplier; where it differs between events, vary it per cast.", "");

  add("### What each sound should be", "");
  for (const c of cues) {
    if (!c.known) {
      add(`#### ${c.cue} (not in the cue library)`, "", c.note, "");
      continue;
    }
    add(`#### \`${c.file}\`: ${c.label} (${c.loop ? "sustained" : "one-shot"}, up to ${c.longest_ms} ms)`, "", c.describes, "");
    const ch = c.character || {};
    const rows = [["Texture", ch.texture], ["Pitch", ch.pitch], ["Envelope", ch.envelope], ["Tail", ch.tail], ["Space", ch.space]].filter((r) => r[1]);
    if (rows.length) add(...rows.map(([k, v]) => `- **${k}**: ${v}`));
    if (ch.layers?.length) add(`- **Built from**: ${ch.layers.join("; ")}`);
    add("");
    add("Text-to-SFX prompt:", "", "```text", c.prompt, "```", "");
    const g = c.generate || {};
    add(`Generator settings: **${g.duration_s} s**, loop **${g.loop ? "on" : "off"}**, make **${g.takes}** takes and keep the best${c.plays > 1 ? " (or keep several and pick one per play for variety)" : ""}.`, "");
    if (c.synth) add(`Procedural recipe: ${c.synth}`, "");
    if (c.search?.length) add(`Library search terms: ${c.search.map((x) => `"${x}"`).join(", ")}.`, "");
  }

  add("### Making the real sounds", "");
  add(
    "Pick one route per sound; they mix fine.",
    "",
    "1. **Text-to-SFX generator** (for example ElevenLabs Sound Effects, or any other text-to-audio tool). Paste the prompt above, set the duration and loop as listed, generate the takes and keep the best. Trim silence at the start so the sound begins on its first sample, then save it under the file name above.",
    "2. **Have an AI write a synthesizer.** Give Claude or GPT this guide and the sounds JSON and ask it to write a Python script (numpy + the standard `wave` module) that renders every file from its procedural recipe. Good for zaps, hums, risers and magic; weaker for real-world sounds like splashes and rocks.",
    "3. **Sound library.** Search the terms above on a library with a clear license (CC0 on Freesound, Kenney, Sonniss GDC bundles). Layer two or three recordings if one doesn't cover the whole description.",
    "",
    "Then for every file: start on the first sample (no silence before the transient), peak at -1 dBFS, fade the last 10-20 ms to silence, and for sustained sounds make the loop seamless (crossfade the end into the start).",
    "",
    "**Copy-paste prompt for Claude or GPT** (attach this guide and the sounds JSON):",
    "",
    "```text",
    `I'm making the sound effects for a game spell, "${m.template.name}". Attached are its SpellDirector guide and ${soundSheetName(id)}. ` +
      "For each cue in the sounds JSON: (1) read its description, character, roles and timing; (2) give me a refined text-to-SFX prompt, duration and loop setting; " +
      "(3) write one Python script (numpy and the standard wave module only) that synthesizes every cue as a 44.1 kHz 16-bit WAV with the exact file names in the JSON, " +
      "following each cue's procedural recipe and character, peak-normalized to -1 dBFS, with seamless loops for sustained cues; (4) tell me which cues would sound better recorded or generated than synthesized. " +
      "Keep the timing: the transient of each one-shot is on its first sample, because the engine starts it at the listed time.",
    "```",
    "",
    "### Playing them in the engine",
    "",
    "- **Unity**: import the WAVs (one-shots: **Load Type: Decompress On Load**; long loops: **Compressed In Memory**). One-shots: `AudioSource.PlayOneShot(clip, volume)` at `at_ms` with `pitch` set on the source. Sustained: a looping AudioSource started at `at_ms` and faded out over about 100 ms at `end_ms`. Volume = `10^(volume_db / 20)`.",
    "- **Godot 4**: an **AudioStreamPlayer** (2D/3D for positional sound) per cue. Set `volume_db` and `pitch_scale` from the event, call `play()` at `at_ms`; for sustained cues enable loop on the imported WAV (Import dock → **Loop Mode: Forward**) and `stop()` (or tween `volume_db` down) at `end_ms`.",
    "- Positional sound: put travel and impact sounds at the target (or on the projectile), build-ups at the caster.",
  );
  return out;
}

// Guide section for six-way lit smoke layers.
// Layers marked volumetric (docs/vocabulary.md#volumetric): the target the
// rebuild has to hit in every view.
export function volumetricGuideLines(layers) {
  return [
    "## Volumetric layers",
    "",
    `These layers must read as a body with real depth and thickness from every angle, not a flat card or strip: ${layers.map((l) => `\`${l.id}\``).join(", ")}. The sprite sheets show them from four cameras; the rebuild has to look thick in all four.`,
    "",
    "- **Never one flat strip or quad on a fixed plane.** From the side or top it turns into a line, a ribbon edge-on or a stretched paper cutout.",
    "- **Crossed or camera-facing layers:** 2-3 strips or quads crossed around the axis, or strips billboarded around their path, or quads stacked at different depths; for a ball, a sphere mesh or stacked camera-facing quads.",
    "- **Core + shell:** a bright, dense inner core inside a wider, softer outer shell.",
    "- **Soft edges:** fade the silhouette with fresnel and noise so no hard rim or quad edge shows; soft particles (depth fade) where it meets the ground or a character.",
    "- **Clouds and billows:** many overlapping puffs of different size and rotation, denser in the middle, not one big sprite.",
    "- **Check all four views** (front, side, top, 3/4) against the sheets before moving to the next layer. Each layer's Unity and Godot steps above say how for its technique.",
  ];
}

export function sixWayGuideLines(list) {
  const lines = [
    "## Six-way lit smoke",
    "",
    "These smoke layers are lit by the scene instead of having their light painted in. Each comes with two flipbooks pre-lit from six directions (a puff over its life, 4 × 4 frames), so a shader can relight every puff from any light: magenta from the left, a fire underneath, the sun behind it.",
    "",
    table(["Smoke", "Maps", "Flipbook", "Albedo", "Play over"], list.map((w) => [
      w.layer,
      `\`${w.positive_map}\`, \`${w.negative_map}\``,
      `${w.columns} × ${w.rows}, ${w.frames} frames of ${w.frame_px} px`,
      w.color,
      `${w.lifetime_ms} ms (one particle's life)`,
    ])),
    "",
    "- **Packing** (Unity's six-way layout): positive map R = lit from the right, G = from the top, B = from the back (light behind the puff shining through its thin edges), A = alpha; negative map R = from the left, G = from below, B = from the front (the camera's side), A = emissive (the thick core, where a fire inside would glow through). Import both **linear** (sRGB off), no compression artifacts on alpha.",
    "- **Shading:** for each light, turn its direction into the particle's frame (x right, y up, z toward the camera, rotated by the particle's spin), square the components as weights and blend: `w.x·(x>0 ? R : L) + w.y·(y>0 ? T : B) + w.z·(z>0 ? Front : Back)`, times the light color and attenuation, times the albedo. Ambient light uses the average of the six maps (sky from the top map, ground from the bottom map).",
    "",
    "**Unity (VFX Graph, URP or HDRP).** Use **Output Particle Six-way Smoke Lit** (Unity 2022.2+). Set **Positive Axes Lightmap** to the `-pos` map and **Negative Axes Lightmap** to the `-neg` map, **UV Mode: Flipbook** with the size above, and drive **Tex Index** from age over lifetime (0 → frames − 1, Flipbook Blend Frames on). Base Color = the albedo; turn on Soft Particles. For a fire inside the smoke, enable **Use Emissive** and color the emissive channel from the fire's palette.",
    "",
    "**Godot 4 (GPUParticles3D).** No built-in six-way output: draw a QuadMesh with a spatial shader (`render_mode blend_mix, depth_draw_never;`, billboard in `vertex()`), sample both maps at the flipbook frame (`INSTANCE_CUSTOM.z` with Particles Anim), set `ALBEDO` to the albedo and `ALPHA` to the positive map's A, and in `light()` add `DIFFUSE_LIGHT += sixway(LIGHT) * ATTENUATION * LIGHT_COLOR / PI` where `sixway()` is the blend above (LIGHT is already in view space, so x/y/z are right/up/toward the camera).",
    "",
    "The viewer draws these exactly this way, so what you saw there is what this builds.",
  ];
  return lines;
}
