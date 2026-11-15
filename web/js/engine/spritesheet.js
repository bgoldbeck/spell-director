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

import { layerIntensity, layerWindow, paramAtFrom, resolveParams } from "./timeline.js";
import { soundEvents } from "./sound.js";
import { decalBlend, decalPlan, decalState } from "./decal.js";

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

// Decals for an engine's decal projector: a top-down texture per decal layer
// plus its timing and per-frame curves (opacity 0-1, scale x full size,
// rotation in degrees). Viewer and export share decalPlan/decalState.
export function buildDecals(template, seed, plan) {
  const chain = template.space?.travel === "chain";
  return (template.layers || []).filter((l) => l.type === "decal").map((l) => {
    const d = decalPlan(template, l, seed, 0);
    const states = plan.times.map((t) => decalState(d, t));
    return {
      layer: l.id,
      shape: d.shape,
      blend: d.blend,
      texture: decalFileName(l.id),
      texture_px: DECAL_TEXTURE_PX,
      color: colorHexes(template, l.color)[0],
      anchor: l.anchor || "target",
      per_target: chain && (l.anchor || "target") === "target",
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
      curves: {
        opacity: states.map((x) => r3(x.opacity)),
        scale: states.map((x) => r3(x.scale)),
        rotation_deg: states.map((x) => r1(x.rotation_deg)),
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
      lights.push({
        ...common,
        anchor: l.anchor || "target",
        color: hex[hex.length - 1],
        radius_units: curve(template, l, plan, seed, (I, p, t) => p("radius", t, 6))[0],
        energy: curve(template, l, plan, seed, (I, p, t) => p("energy", t, 2) * I),
      });
    }
  }
  const cues = cueLibrary.cues || {};
  const sounds = soundEvents(template, seed, cueLibrary).map((e) => ({
    layer: e.layer,
    cue: e.cue,
    kind: e.kind,
    at_ms: r1(e.at),
    frame: frameAt(plan, e.at),
    duration_ms: r1(e.dur),
    gain: r3(e.gain),
    pitch: r3(e.rate),
    loop: e.kind === "sustained",
    samples: cues[e.cue]?.samples || [],
    sfx_prompt: cues[e.cue]?.sfx_prompt || "",
  }));
  return { screen_flashes: screenFlashes, camera_shake: shakes, lights, sounds };
}

// sheets: [{id, first, count, layout}] (the whole-spell sheet first).
// visible: {layerId: {first, last} | null} over all exported views.
// views: {view: {pivots, px_per_unit, camera}} in row order.
export function buildManifest({ template, seed, plan, sheets, visible, views, tracks, version = "", frame, bloom = true }) {
  const loop = !!template.timing?.loop;
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
      blend: l.type === "decal" ? decalBlend(l) : l.blend || (l.type === "smoke" ? "alpha" : "add"),
      color_slot: l.color || "primary",
      colors: colorHexes(template, l.color),
      z: l.z ?? 0,
      anchor: l.anchor || "target",
      attach_to: l.attach_to || null,
      plane: l.plane || DEFAULT_PLANE[l.type] || "volume",
      loop,
      params: resolveParams(l.params, seed, `${l.id}#0`),
      keyframes: l.keyframes || [],
      empty: !visible[l.id],
    };
  });
  const tracksOut = tracks || { screen_flashes: [], camera_shake: [], lights: [], sounds: [] };
  const decals = buildDecals(template, seed, plan);
  return {
    format: FORMAT,
    generator: `SpellDirector ${version}`.trim(),
    template: { id: template.id, name: template.name, element: template.element, archetype: template.archetype, description: template.description || "" },
    seed,
    duration_ms: plan.duration,
    loop,
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
    decals,
    ...tracksOut,
  };
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

  const nViews = viewList.length;
  const all = m.sheets.find((x) => x.id === ALL_ID);
  add("## At a glance", "");
  add(table(["", ""], [
    ["Length", `${m.duration_ms} ms, ${m.loop ? "loops" : "plays once (one-shot)"}`],
    ["Frame rate", `${m.fps} fps (one frame every ${m.frame_ms} ms)`],
    ["Frames", `${m.frame_count} for the whole spell (frame 0 is 0 ms)`],
    ["Cell size", `${fw} × ${fh} px`],
    ["Sheets", `${m.sheets.length}: \`${all?.image ?? "all.png"}\` for the whole spell, plus one per layer`],
    ["Rows in every sheet", viewList.map((v, i) => `${i} ${VIEW_NAMES[v] || v}${v === m.hero_view ? " (hero)" : ""}`).join(", ")],
    ["Alpha", "Straight (not premultiplied), transparent background"],
    ["Bloom", m.bloom_baked ? "Baked into the sprites (the soft glow around bright parts). Turn your engine's bloom down on these, or export without bloom." : "Not baked in: add bloom in your engine for the glow"],
  ]), "");

  add("## Files", "");
  const fileRows = m.sheets.map((sh) => [`\`${sh.image}\``, sh.id === ALL_ID ? "The whole spell, every layer together" : `Layer \`${sh.id}\``]);
  for (const f of files || []) fileRows.push([`\`${f.name}\``, f.about]);
  for (const d of m.decals || []) fileRows.push([`\`${d.texture}\``, `Top-down texture of decal \`${d.layer}\` for a decal projector`]);
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
    add(...bits.map((b) => `- ${b}`));
    const params = Object.entries(l.params || {});
    if (params.length) add(`- Settings for this seed: ${params.map(([k, v]) => `${k} ${typeof v === "number" ? r3(v) : v}`).join(", ")}.`);
    if (l.keyframes?.length) add(`- Keyframes (already baked into the frames): ${l.keyframes.map((k) => `${k.param} → ${k.value} at ${k.t_ms} ms`).join("; ")}.`);
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
      "- **Per target**: a decal marked `per_target` repeats on every chain target, delayed by each hop.",
      "- **Blend**: `alpha` decals paint the ground (scorch darkens it, puddles tint it). `add` decals are light on the ground (glowing cracks, rune circles, warning rings): use emission, not albedo.",
      "",
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
    add(table(["Layer", "At", "Color", "Range", "When"], m.lights.map((l) => [l.layer, l.anchor, l.color, `${l.radius_units} units`, curveSummary(l.energy, plan)])), "");
    add("Add a point light at that spot (about 0.8 units up) and set its intensity from the `energy` curve to light up the scene around the spell.", "");
  }
  if (m.sounds.length) {
    add("### Sound cues", "");
    add(table(
      ["At", "Frame", "Cue", "Kind", "Length", "Volume", "Pitch", "Layer"],
      m.sounds.map((s) => [`${s.at_ms} ms`, s.frame, s.cue, s.loop ? "sustained (loop it until it ends)" : "one-shot", `${s.duration_ms} ms`, s.gain, s.pitch, s.layer]),
    ), "");
    const prompts = [...new Map(m.sounds.filter((s) => s.sfx_prompt).map((s) => [s.cue, s.sfx_prompt])).entries()];
    if (prompts.length) {
      add("The viewer's sounds are placeholders. To make real ones, these prompts work with a text-to-sound-effects tool:", "");
      add(...prompts.map(([c, p]) => `- **${c}**: ${p}`), "");
    }
  }
  if (!m.screen_flashes.length && !m.camera_shake.length && !m.lights.length && !m.sounds.length) add("None for this spell.", "");

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

  add("## Machine-readable data", "");
  add(
    `The JSON file has everything above in format \`${m.format}\`: \`sheets\` (image, first_frame, frame_count, start_ms, end_ms, columns, rows), \`view_rows\` and \`views\` (row, pivots, px_per_unit), \`layers\` (blend, colors, z, anchor, params for this seed), \`beats\`, \`decals\` (texture, size, timing and per-frame opacity, scale and rotation), \`screen_flashes\`, \`camera_shake\`, \`lights\` and \`sounds\`. Curves have one value per spell frame. An importer script can build the whole effect from it.`,
    "",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
