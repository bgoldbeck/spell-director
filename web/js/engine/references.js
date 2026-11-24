// The "use every reference" contract at the top of an export's guide. Pure,
// so the guide, the JSON and Node tests share it.
//
// An export hands a builder (a person, or an AI such as Claude or GPT working
// in Unity, Godot, ...) many references: four camera views, a sheet per
// layer, beats, must-read cues, key frames, render code, the caster rig and
// timeline, sounds, decal maps and a range guide. Builders, AI ones above all,
// tend to glance at one view and the first sheet, then guess the rest. This
// lists every reference this export actually has, what to take from it, and
// how to check the rebuild against it, and says plainly that the build isn't
// done until every check has been made.

const VIEW_LABEL = { front: "Front", side: "Side", top: "Top", three_quarter: "3/4" };
const VIEW_SHOWS = {
  front: "height, width and silhouette as the target sees it",
  side: "the cast path and distance from caster to target, and how high it travels",
  top: "the ground footprint: radius, spread, direction and anything laid on the ground",
  three_quarter: "the gameplay camera's read: depth, overlap and how the layers stack",
};

export const RANGE_GUIDE_DIR = "range-guide";
export const rangeGuideFiles = (id) => ({
  png: `${RANGE_GUIDE_DIR}/${id}-range-guide.png`,
  md: `${RANGE_GUIDE_DIR}/${id}-range-guide.md`,
  json: `${RANGE_GUIDE_DIR}/${id}-range-guide.json`,
});

// The ground rules, in the order the guide prints them.
export const REFERENCE_RULES = [
  "**Every reference below is required.** They were made so you don't have to guess. Open each one, use it while you build, and check your build against it. Skipping one is not a shortcut, it is a mistake.",
  "**Look at all four views, not just one.** A spell that looks right from the front can be wrong from the top (footprint), the side (path and height) or 3/4 (depth). Compare every view at every check.",
  "**Don't replace the reference with a generic effect.** If you catch yourself building \"a lightning bolt\" or \"a fire burst\" from memory, stop and go back to the sheets, the beats and the render notes. The spell is this one, not the average one.",
  "**Don't guess numbers that are written down.** Timings, colors, sizes, blend modes, draw order, distances and sockets are in this guide, the JSON and the timeline. Use them as given.",
  "**Look, don't assume.** Open the images and actually look at them (crop cells with `python tools/sheet_cells.py contact <export folder> --sheet <layer>` or the director's `look_at_sprite_sheet` tool). Reading a file name is not looking at it.",
  "**If a reference is missing or you can't use it, say so.** Don't quietly skip it. Name the file and why, and keep going with the rest.",
  "**You are not done until the final check passes.** When you report back, list each item of the checklist with what you compared and the result (matches, close, or what is still off). \"Looks good\" is not a report.",
];

// Every reference this export has, as [{id, ref, files, use, check}].
// `m` is the sprite sheet manifest, read after the rig, sound and render
// notes have been added to it.
export function referenceChecklist(m) {
  const id = m.template.id;
  const views = Object.keys(m.views || {});
  const all = (m.sheets || []).find((s) => s.id === "all");
  const layerSheets = (m.sheets || []).filter((s) => s.id !== "all");
  const out = [];
  const item = (key, ref, files, use, check) => out.push({ id: key, ref, files, use, check });

  for (const v of views) {
    item(`view-${v}`, `${VIEW_LABEL[v] || v} view${v === m.hero_view ? " (hero view)" : ""}`, [`row ${m.views[v].row} of every sheet`],
      `Shows ${VIEW_SHOWS[v] || "the spell from this camera"}.${m.views[v].reads ? ` In this spell: ${m.views[v].reads}` : ""} Set up a matching camera in your scene (the JSON's \`views.${v}\` gives its camera type, pixels per unit and where the caster and target sit in the frame).`,
      `Render your build from this camera at the key frames and put it next to row ${m.views[v].row}: same footprint, same direction, same height, same layer overlap.`);
  }
  item("sheet-all", "Whole-spell sheet", [all?.image || "all.png"],
    "The finished spell, every layer together, frame by frame. This is the target.",
    "Play your build next to it frame by frame through every beat, in every view. Same order, same timing, same footprint, same colors.");
  if (layerSheets.length) {
    item("sheet-layers", `Layer sheets (${layerSheets.length})`, layerSheets.map((s) => s.image),
      "One sheet per layer, alone. Build each layer from its own sheet, not from the whole-spell sheet.",
      "Solo each layer with its on/off switch and compare it with its sheet in every view before adding the next layer.");
  }
  item("data", "Spell data", [`${id}.spritesheet.json`, `${id}.template.json`],
    "Exact timings, frames, colors, blend modes, draw order, anchors, curves and the template the spell came from. Read numbers from here instead of estimating them from pixels.",
    "Every layer's start and end time, blend mode, color and draw order in your build match the JSON.");
  if (m.beats?.length) {
    item("beats", `Beats (${m.beats.length})`, ["Timeline (beats) in this guide", `beats in ${id}.spritesheet.json`],
      "The phases of the spell and what should happen in each.",
      `Each beat starts and ends at the given time (${m.beats.map((b) => b.id).join(", ")}) and does what its "What should happen" says.`);
  }
  item("layers", `Layer notes and shader intent (${(m.layers || []).length})`, ["Layers section of this guide"],
    "Per layer: blend, color, anchor, plane, tracking, settings for this seed, shader intent and the Unity and Godot recipes.",
    "Every layer exists in your build, with its own switch, and uses the blend, color, anchor and shader intent listed for it.");
  const vol = (m.layers || []).filter((l) => l.shader?.volumetric);
  if (vol.length) {
    item("volumetric", `Volumetric layers (${vol.length})`, ["Volumetric layers section of this guide", ...vol.map((l) => l.image).filter(Boolean)],
      `These must read as a thick body with real depth from every angle, never a flat card or strip: ${vol.map((l) => l.id).join(", ")}. The section says how (crossed or camera-facing layers, core and shell, soft edges, many puffs).`,
      `Look at each of ${vol.map((l) => l.id).join(", ")} in all four views (front, side, top, 3/4) next to its sheet: it looks thick in every one, and never turns into a line, an edge-on ribbon or a paper cutout from the side or top.`);
  }
  const r = m.readability;
  if (r?.must_read?.length) {
    item("must-read", `Must-read cues (${r.must_read.length})`, ["Quality target section of this guide", `readability.must_read in ${id}.spritesheet.json`],
      "What has to stay readable at gameplay distance. Protect these over everything else.",
      `Each cue is clearly visible in your build at ${r.reference_distance} units away: ${r.must_read.map((c) => c.cue).join("; ")}.`);
  }
  if (r?.key_frames?.length) {
    item("key-frames", `Key frames (${r.key_frames.length})`, ["Quality target section of this guide"],
      "The moments that define the spell.",
      `Capture your build at ${r.key_frames.map((k) => `${k.t_ms} ms`).join(", ")} in every view and compare each with the sheets' frames at the same times.`);
  }
  const rg = rangeGuideFiles(id);
  item("range-guide", "Range guide", [rg.png, rg.md, rg.json],
    "How wide each part reads at the reference distance and at gameplay camera distances, with annotated key frames, the must-read cues and how each layer moves when an actor moves. If this export has no `range-guide/` folder, make one: `python tools/range_guide.py " + id + "`.",
    "Measure your build's parts (core width, glow, footprint, height) and compare them with the range guide's numbers and annotated frames.");
  if (m.render) {
    item("render-notes", `How we rendered it (${(m.render.layers || []).length} layers)`, [m.render.porting, ...(m.render.layers || []).map((l) => l.file)],
      "The viewer's own code, materials, blend state, uniforms and GLSL for each layer, and how each piece maps to Unity and Godot. Port the technique, don't reinvent it.",
      "Each layer's material in your build does what its render note does (same blend, same noise and flow, same falloff), and you read the note before building that layer.");
  }
  if (m.caster_rig) {
    item("caster-rig", "Caster rig and timeline", [m.caster_rig.glb, m.caster_rig.timeline, m.caster_rig.clip].filter(Boolean),
      "A Mixamo-named skeleton with the casting animation, and every event tied to a time and a bone socket or world point.",
      "Effects spawn from the sockets the timeline names (the casting hand, the target, the sky point) at the times it gives, and follow the bones they should.");
  }
  if (m.sound_sheet) {
    const audio = (m.sound_files || []).filter((f) => f.endsWith(".wav") || f.endsWith(".ogg"));
    item("sound", "Sound", [m.sound_sheet, ...audio],
      "What plays when, what each sound should be, and the sound files themselves.",
      "Every cue plays at its time in the sound sheet, with the given file (or one of the same character), and the preview mix lines up with your build.");
  }
  if (m.decals?.length) {
    const files = m.decals.flatMap((d) => [d.texture, d.height_map, d.emissive_mask, d.flow_map].filter(Boolean));
    item("decals", `Decal textures (${m.decals.length})`, files,
      "Top-down textures, height, fill and flow maps and timing curves for ground marks.",
      "Each decal sits on the ground at the given size and rotation, uses its maps, and follows its opacity and scale curves.");
  }
  if (m.six_way_smoke?.length) {
    item("six-way", "Six-way smoke lightmaps", m.six_way_smoke.flatMap((w) => [w.positive_map, w.negative_map]),
      "Lightmap flipbooks so smoke takes the scene's lights.",
      "Smoke in your build uses these maps and is lit by the spell's lights, not flat.");
  }
  if (m.loop_range) {
    item("loop", "Aura loop", ["Aura section of this guide", `loop_range in ${id}.spritesheet.json`],
      "Where the start-up ends, which frames loop seamlessly, and the ending.",
      "Your loop has no visible seam and repeats exactly the looped frames' motion.");
  }
  return out;
}

// The guide section: rules, then the reference table, then the final check.
export function referenceChecklistLines(m, items = referenceChecklist(m)) {
  const lines = ["## Use every reference (required)", ""];
  lines.push(
    "This export is a complete reference pack. It is for whoever rebuilds the spell in a game engine, and it is written with AI builders (Claude, GPT, ...) in mind. Read this section before anything else and follow it to the letter.",
    "",
  );
  lines.push(...REFERENCE_RULES.map((x) => `- ${x}`), "");
  lines.push("### Before you build: study each reference", "");
  for (const it of items) {
    lines.push(`- [ ] **${it.ref}**: ${it.files.map((f) => (f.includes(" ") ? f : `\`${f}\``)).join(", ")}. ${it.use}`);
  }
  lines.push("");
  lines.push("### Before you call it done: check against each reference", "");
  lines.push("Do this after each layer (for that layer) and again at the end (for the whole spell). Every box must be ticked, with what you compared written next to it.", "");
  for (const it of items) lines.push(`- [ ] **${it.ref}**: ${it.check}`);
  lines.push("");
  lines.push(
    "When you report back, copy this list and fill in each line: what you compared, in which views and at which times, and whether it matches. If something still doesn't match, say what and why, and keep working on it unless you were told to stop.",
    "",
  );
  return lines;
}

// README.md at the top of the export: the first file anyone (or any AI) opens.
export function readmeMarkdown(m, items = referenceChecklist(m)) {
  const id = m.template.id;
  return [
    `# ${m.template.name}: SpellDirector export (start here)`,
    "",
    `This folder is a complete reference pack for rebuilding the spell \`${id}\` (seed ${m.seed}) in a game engine.`,
    "",
    "**If you are an AI model building this spell** (in Unity, Godot or anything else): do not be lazy with it. Every file here was made so you don't have to guess, and you are expected to use all of them.",
    "",
    `1. Read \`${id}.guide.md\` first, starting with its **Use every reference (required)** section.`,
    "2. Study every reference it lists before you build: all four camera views (front, side, top, 3/4), the whole-spell sheet and every layer sheet, the beats, the must-read cues and key frames, the range guide, the render notes (`render/`), the caster rig and timeline, and the sounds.",
    "3. Build one layer at a time, each with its own on/off switch, and compare each layer with its sheet in every view before adding the next.",
    "4. Before you call it done, check the build against every item in the guide's final checklist, and report each one with what you compared and the result.",
    "",
    `This export has ${items.length} references to use: ${items.map((i) => i.ref).join(", ")}.`,
    "",
  ].join("\n");
}
