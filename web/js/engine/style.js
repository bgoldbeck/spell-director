// Art styles: one template, several looks. A style changes how the viewer
// draws a spell (bloom, grading, decal depth, cel bands, pixels) and, more
// importantly, what the export tells an engine artist or an AI to build:
// per-style shader vocabulary for Unity and Godot. Pure (no DOM, no Three.js)
// so the guide, the exporter and the Node tests share it.
//
// A template may name its default style (`style.preset`); the viewer and the
// export can override it. Layers may refine their shader intent per style with
// `shader.styles.<style>` (docs/vocabulary.md section 12).

export const STYLE_IDS = ["stylized", "realistic", "toon", "pixel"];
export const DEFAULT_STYLE = "stylized";

// view: how the viewer and exporter draw it.
//   bloom: UnrealBloom settings. tone: "none" | "aces" (viewer only).
//   saturation: 1 = as authored. posterize: colour levels per channel (0 = off).
//   outline: 0-1 ink edges. pixel: art-pixel size as a fraction of the frame
//   (0 = off). decal: "flat" | "depth" (parallax, lit walls) | "bands" (cel).
export const STYLES = {
  stylized: {
    label: "Stylized",
    about: "Clean, readable shapes in saturated color, soft gradients and strong bloom. The default: suits most action games, MOBAs and ARPGs.",
    look: "Bold silhouettes and saturated palette colors; additive glows with a white-hot core; soft noise; bloom does a lot of the work.",
    view: { bloom: { strength: 0.6, radius: 0.3, threshold: 0.7 }, tone: "none", saturation: 1, posterize: 0, outline: 0, pixel: 0, decal: "flat" },
    unity: [
      "Color: keep the palette saturated; additive (or premultiplied) blending for light, alpha for matter.",
      "Bloom: URP/HDRP Volume Bloom, threshold ~0.9, intensity ~1; drive layers with HDR emission ×2–6.",
      "Shapes: soft gradients and smooth noise (Gradient Noise, Voronoi); readable silhouettes beat detail.",
    ],
    godot: [
      "Color: keep the palette saturated; `blend_add` for light, `blend_mix` for matter.",
      "Glow: WorldEnvironment Glow on (HDR threshold ~0.9, intensity ~1); EMISSION ×2–6.",
      "Shapes: soft gradients and smooth noise (NoiseTexture2D); readable silhouettes beat detail.",
    ],
    layer: {},
  },

  realistic: {
    label: "Realistic",
    about: "Physically based: lit smoke, ground that really cracks open with depth, heat haze, real lights and filmic tone mapping.",
    look: "Matter looks like matter: lit, shadowed, with depth and weight. Light comes from hot things and lights the scene. Colors are less saturated; only truly hot or energetic parts glow, and they over-expose to white.",
    view: { bloom: { strength: 0.45, radius: 0.5, threshold: 0.85 }, tone: "aces", saturation: 0.9, posterize: 0, outline: 0, pixel: 0, decal: "depth" },
    unity: [
      "Pipeline: HDRP or URP with HDR on, linear color, ACES (or Neutral) tone mapping; Bloom threshold ~1 so only true HDR glows bloom.",
      "Every particle that touches geometry uses Soft Particles (depth fade) so it never cuts a hard line into the ground.",
      "Hot and energetic layers light the scene: real point/spot lights with intensity curves from the export (`lights`), shadows on for the main hit.",
      "Heat and shockwaves bend the air: a distortion pass (Scene Color with noise-offset UVs; HDRP Distortion) around fire, lightning cores and impact rings.",
      "Ground marks are depth decals (height map + Parallax Occlusion Mapping + normal from height), not flat stickers; see the decal recipe.",
    ],
    godot: [
      "Renderer: Forward+, HDR 2D/3D on, WorldEnvironment tonemap ACES (or AgX/Filmic), Glow with HDR threshold ~1.",
      "Particles: `proximity_fade_enabled` (or a depth-fade in the shader) so particles meet the ground softly.",
      "Hot and energetic layers light the scene: OmniLight3D/SpotLight3D driven by the export's `lights` curves, shadows on for the main hit.",
      "Heat haze: a spatial shader that samples `hint_screen_texture` at SCREEN_UV + noise around fire, lightning cores and impact rings.",
      "Ground marks use height maps with parallax (StandardMaterial3D Heightmap with Deep Parallax, or your own POM loop), not flat decals; see the decal recipe.",
    ],
    layer: {
      decal: {
        unity: [
          "Depth decal: use `decal-<id>-height.png` (white = ground level, black = deepest) in a URP Decal Shader Graph (HDRP: Decal Shader Graph) with a **Parallax Occlusion Mapping** node (16–32 steps, amplitude ≈ `depth` × 0.05 of the decal width) feeding the UVs of every sample.",
          "Normal From Height on the same height map into the decal's Normal output (Affect Normal on), so the crack walls catch the scene light and the rim reads raised.",
          "Fake occlusion: multiply Base Color by lerp(1, 0.25, depth) so the bottom of cracks and craters goes dark.",
          "Fill (lava, glow, liquid, void): the emissive mask `decal-<id>-emissive.png` sampled at the parallax UV × flowing noise; for lava, flow it with `decal-<id>-flow.png` (a flow map: two noise samples scrolled along the map's direction, cross-faded each half cycle), color it core→primary by depth with HDR ×4–8, then cool it to a dark crust over the fade (lerp emission to 0 and Base Color to near-black).",
          "For close-up hero shots, swap the decal for a real mesh: a ground tile with the cracks cut in (or tessellation/displacement in HDRP) plus a lava plane under it.",
        ],
        godot: [
          "Godot's Decal node has no parallax: for the depth look use a QuadMesh lying on the ground with a spatial shader (or StandardMaterial3D with Heightmap on, Deep Parallax, 8–32 layers) using `decal-<id>-height.png`; flip the heightmap if the walls look raised (`heightmap_flip_texture`).",
          "Normal from height: StandardMaterial3D's Normal Map from the same image (bake one with any height-to-normal tool) or compute it in the shader from three height samples.",
          "Fake occlusion: ALBEDO *= mix(1.0, 0.25, depth).",
          "Fill: EMISSION = fill color × emissive mask × flowing noise × HDR 4–8 (UV scrolled along `decal-<id>-flow.png` for lava), fading to a dark crust over the fade.",
          "Far away a plain Decal node (albedo + normal + emission textures) is enough.",
        ],
      },
      smoke: {
        unity: [
          "Lit smoke: VFX Graph **Output Particle Six-way Smoke Lit** (or a normal-mapped flipbook) so puffs are lit by the scene and the effect's own lights, darker underneath, with Soft Particles.",
        ],
        godot: [
          "Lit smoke: GPUParticles3D with a normal-mapped smoke flipbook in a lit material (not unshaded), proximity fade on, so the effect's own lights shade it.",
        ],
      },
      sparks: {
        unity: [
          "Sparks: Stretched Billboard / Orient Along Velocity, collide with the ground and bounce once, Color over Lifetime cooling core → primary → dark, short motion blur.",
        ],
        godot: [
          "Sparks: `particle_flag_align_y` along velocity with a stretched quad, collision on (bounce ~0.3), color ramp cooling core → primary → dark.",
        ],
      },
      bolt: {
        unity: ["Core over-exposes to white (HDR 6–10) while the edges keep the hue; a flickering real light at the strike; heat-haze distortion strip around the core."],
        godot: ["Core over-exposes to white (EMISSION ×6–10) while the edges keep the hue; a flickering OmniLight3D at the strike; a screen-texture distortion strip around the core."],
      },
      beam: {
        unity: ["Core over-exposes to white (HDR 6–10); edges keep the hue; distortion around the beam; a light that travels along it (or a few spaced lights)."],
        godot: ["Core over-exposes to white (EMISSION ×6–10); edges keep the hue; screen-texture distortion around the beam; a few OmniLight3Ds along it."],
      },
      ring: {
        unity: ["A shockwave is mostly a refraction ring (distortion) with a faint visible edge, plus dust kicked up from the ground where it passes."],
        godot: ["A shockwave is mostly a refraction ring (`hint_screen_texture` offset) with a faint visible edge, plus dust particles where it passes."],
      },
      eruption: {
        unity: ["Real rock meshes with triplanar rock textures and normal maps, lit and shadowed; debris with physics (or VFX Graph collision); dust as lit soft particles."],
        godot: ["Real rock meshes (triplanar StandardMaterial3D with normal maps), lit and shadowed; debris as RigidBody3D or colliding particles; dust as lit soft particles."],
      },
      orb: {
        unity: ["Volumetric look: layered noise quads or a raymarched sphere; fresnel rim; refraction of what's behind it; a real light at its centre."],
        godot: ["Volumetric look: layered noise quads or a raymarched sphere in a spatial shader; fresnel rim; refraction via `hint_screen_texture`; an OmniLight3D at its centre."],
      },
      wave: {
        unity: ["Water mesh with depth-based color, refraction, specular, and foam where it meets geometry (depth intersection)."],
        godot: ["Water mesh with depth-based color (`hint_depth_texture`), refraction, specular, and foam where it meets geometry."],
      },
      glow: {
        unity: ["Keep glow sprites subtle: the light layer and bloom carry the glow; real lights do the lighting."],
        godot: ["Keep glow sprites subtle: lights and Glow carry it."],
      },
    },
  },

  toon: {
    label: "Toon",
    about: "Cel-shaded, anime or cartoon: flat color bands, hard edges, dark ink outlines, bold shapes and snappy timing.",
    look: "Flat shapes with crisp edges and two or three color bands instead of gradients; dark outlines on solid shapes; white-hot cores as a flat band; snappy timing with held frames.",
    view: { bloom: { strength: 0.3, radius: 0.15, threshold: 0.92 }, tone: "none", saturation: 1.15, posterize: 5, outline: 1, pixel: 0, decal: "bands" },
    unity: [
      "Color ramps: Step/Posterize instead of smooth gradients (a 2–3 band Sample Gradient with Fixed mode); hard alpha edges (Alpha Clip, Step not Smoothstep).",
      "Outlines: inverted-hull outlines on solid shapes (rocks, orbs, waves) or a full-screen outline (depth/normal edge detection) Renderer Feature.",
      "Timing: animate on twos (12 fps) for flipbooks, add smear frames and anticipation; bloom low or off.",
    ],
    godot: [
      "Color ramps: `step()` / `floor(x * bands) / bands` instead of smooth gradients; ALPHA_SCISSOR_THRESHOLD for hard edges.",
      "Outlines: a second material pass with `cull_front` and the vertex pushed along NORMAL (inverted hull), or a screen-space outline shader.",
      "Timing: animate on twos (12 fps) for flipbooks, add smear frames and anticipation; Glow low or off.",
    ],
    layer: {
      decal: {
        unity: ["Flat banded decal: Posterize the mask into 2–3 bands, a thick dark outline at its edge; any fill is a flat bright color with a hard edge (stepped flow at most)."],
        godot: ["Flat banded decal: posterize the mask into 2–3 bands, a dark outline at its edge; any fill is a flat bright color with a hard edge."],
      },
      smoke: {
        unity: ["Toon smoke: solid puffs with 2-tone shading (Step on N·L) and an outline; erode with a stepped dissolve rather than a fade."],
        godot: ["Toon smoke: solid puffs with 2-tone shading (`step(0.5, dot(NORMAL, LIGHT))`) and an outline; stepped dissolve rather than a fade."],
      },
      sparks: {
        unity: ["Sparks as solid stars, diamonds or dashes in one flat color with a white core band; no blur."],
        godot: ["Sparks as solid stars, diamonds or dashes in one flat color with a white core band; no blur."],
      },
      bolt: {
        unity: ["Two-tone zigzag: a flat white core band and a flat colored outer band, hard edges, held for a frame or two."],
        godot: ["Two-tone zigzag: a flat white core band and a flat colored outer band, hard edges, held for a frame or two."],
      },
      beam: {
        unity: ["Two-tone beam: flat white core, flat colored sheath, outline; wobble in steps."],
        godot: ["Two-tone beam: flat white core, flat colored sheath, outline; wobble in steps."],
      },
    },
  },

  pixel: {
    label: "Pixel art",
    about: "Low-resolution pixel art: chunky pixels, a limited palette, no anti-aliasing and flipbook timing.",
    look: "Every layer snaps to a coarse pixel grid with a handful of palette shades and hard edges; glows become a ring of brighter pixels; motion in held flipbook frames.",
    view: { bloom: { strength: 0.25, radius: 0.1, threshold: 0.9 }, tone: "none", saturation: 1.1, posterize: 5, outline: 0, pixel: 1 / 64, decal: "flat" },
    unity: [
      "Here the exported sheets are close to final art: export small cells (64–128 px), import with **Filter Mode: Point**, **Compression: None**, and play them as flipbooks (VFX Graph Flipbook, or a SpriteRenderer animation) at 8–12 fps.",
      "Use the Pixel Perfect Camera (URP 2D) and snap particle positions to the pixel grid; no bloom, or a 1-pixel bright outline instead.",
      "Palette: the template's palette slots plus one darker and one lighter shade each; no gradients.",
    ],
    godot: [
      "Here the exported sheets are close to final art: export small cells (64–128 px), set **Texture Filter: Nearest** and play them with AnimatedSprite2D/3D or GPUParticles with Particles Anim at 8–12 fps.",
      "Snap to the pixel grid (Project Settings → Rendering → 2D → Snap 2D Transforms/Vertices to Pixel); no Glow, or a 1-pixel bright outline.",
      "Palette: the template's palette slots plus one darker and one lighter shade each; no gradients.",
    ],
    layer: {
      decal: {
        unity: ["Draw the decal as a pixel sprite under the characters (or a Point-filtered decal texture), 2–3 shades, hard edge."],
        godot: ["Draw the decal as a Nearest-filtered sprite under the characters, 2–3 shades, hard edge."],
      },
    },
  },
};

// Decal fills: what sits in the bottom of cracks and craters.
export const DECAL_FILLS = {
  none: { about: "nothing" },
  lava: { about: "molten rock that flows along the cracks, white-hot deep down, cooling to a dark crust", glow: true, flow: true, color: "gradient_core_to_primary" },
  glow: { about: "light shining up out of the cracks (energy, lightning, holy or arcane power)", glow: true, color: null },
  liquid: { about: "liquid pooling in the cracks (water, blood, poison), glossy, no glow", glow: false, color: "primary" },
  void: { about: "darkness welling up from below, near black with a faint colored swirl (shadow, dark magic)", glow: false, flow: true, color: "shadow" },
};

// How deep each decal shape looks with depth (1 = carved deep, negative =
// raised above the ground, 0 = flat).
export const SHAPE_DEPTH = {
  cracks: 1, fissures: 1, crater: 0.9, slash: 0.8, swirl: 0.55, swept: 0.25, scorch: 0.15, burn: 0.08,
  rune_circle: 0.2, splash: 0, puddle: 0, warning_ring: 0, frost: -0.4,
};

export function isStyle(id) {
  return STYLE_IDS.includes(id);
}

/**
 * The style a template is drawn in: `override` (the viewer's or export's
 * choice) if valid, else the template's `style.preset`, else stylized.
 * Returns {id, label, about, look, view, depth, notes, from}.
 */
export function resolveStyle(template, override) {
  const t = template?.style || {};
  const id = isStyle(override) ? override : isStyle(t.preset) ? t.preset : DEFAULT_STYLE;
  const s = STYLES[id];
  const view = { ...s.view, bloom: { ...s.view.bloom } };
  // The template's own knobs refine the preset it names.
  if (t.preset === id || !t.preset) {
    if (typeof t.saturation === "number") view.saturation = t.saturation;
    if (typeof t.outline === "number") view.outline = t.outline;
    if (typeof t.bloom === "number") view.bloom.strength *= t.bloom;
  }
  return {
    id,
    label: s.label,
    about: s.about,
    look: s.look,
    view,
    depth: typeof t.depth === "number" ? Math.max(0, Math.min(1, t.depth)) : 0.6,
    notes: t.preset === id || !t.preset ? t.notes || "" : "",
    from: isStyle(override) ? "chosen" : isStyle(t.preset) ? "template" : "default",
  };
}

/** The layer's shader intent merged with its per-style refinement, if any. */
export function shaderForStyle(shader, styleId) {
  if (!shader) return shader;
  const { styles, ...base } = shader;
  const extra = styles?.[styleId];
  if (!extra) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? { ...base[k], ...v } : v;
  }
  return out;
}

/** Extra Unity and Godot steps for a layer in a style. */
export function styleRecipe(styleId, layer, params = {}) {
  const s = STYLES[styleId] || STYLES[DEFAULT_STYLE];
  const per = s.layer[layer.type] || {};
  const unity = [...(per.unity || [])];
  const godot = [...(per.godot || [])];
  if (layer.type === "decal") {
    const fill = DECAL_FILLS[params.fill] ? params.fill : "none";
    if (fill !== "none") {
      const f = DECAL_FILLS[fill];
      unity.push(`This decal's fill is **${fill}**: ${f.about}.${styleId === "realistic" ? "" : ` In this style draw it ${styleId === "toon" ? "as a flat band with a hard edge" : styleId === "pixel" ? "in 2–3 palette shades" : "as a soft emissive band in the middle of the mark, gently flowing"}.`}`);
      godot.push(`This decal's fill is **${fill}**: ${f.about}.`);
    }
  }
  return { unity, godot };
}

/** Plain decal params for depth and fill, with defaults. */
export function decalLook(shape, params = {}, style) {
  const fill = DECAL_FILLS[params.fill] ? params.fill : "none";
  const shapeDepth = SHAPE_DEPTH[shape] ?? 0;
  const depth = typeof params.depth === "number" ? Math.max(-1, Math.min(1, params.depth)) : shapeDepth * (style?.depth ?? 0.6) / 0.6;
  return {
    fill,
    fill_color: params.fill_color || DECAL_FILLS[fill].color || null,
    fill_flow: typeof params.fill_flow === "number" ? params.fill_flow : 1,
    fill_in_ms: typeof params.fill_in_ms === "number" ? Math.max(0, params.fill_in_ms) : 200,
    depth,
  };
}

/**
 * How a decal is drawn in a style: its depth and fill, the material mode
 * (flat, depth, bands), and whether it needs the decal shader. In the
 * realistic style a glowing (add) carved mark becomes a crack in the ground
 * with light in it. Shared by the viewer and the export.
 */
export function decalRender(shape, blend, lookParams, style, colorSlot) {
  const look = decalLook(shape, lookParams, style);
  const light = blend === "add";
  // Light marks barely carved (a hot burn) stay flat light on the ground.
  const depthMode = style.view.decal === "depth" && Math.abs(look.depth) > (light ? 0.12 : 0.01);
  let fill = look.fill;
  let fillColor = look.fill_color;
  if (depthMode && light && fill === "none") {
    fill = "glow";
    fillColor = colorSlot || "primary";
  }
  const mode = depthMode ? "depth" : style.view.decal === "bands" ? "bands" : "flat";
  return { ...look, depth: depthMode ? look.depth : 0, fill, fill_color: fillColor, light, mode, custom: fill !== "none" || mode !== "flat" };
}

// ------------------------------------------------------------ export cells

const clamp255 = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);

/**
 * Restyle one exported cell (straight-alpha RGBA, size × size) in place for
 * the toon and pixel styles, the looks that can't be baked in the 3D render
 * without breaking the black/white matte. Stylized and realistic cells pass
 * through unchanged. `ink` is the outline color [r, g, b].
 */
export function styleCell(data, size, view, ink = [12, 10, 16]) {
  if (!view) return data;
  if (view.pixel > 0) pixelate(data, size, Math.max(2, Math.round(size * view.pixel)));
  if (view.posterize > 0) posterize(data, view.posterize, view.pixel > 0 ? 3 : 4);
  if (view.outline > 0) outline(data, size, Math.max(1, Math.round((size / 160) * view.outline)), ink);
  return data;
}

// Average each block (alpha-weighted) and fill it with one color: chunky pixels.
export function pixelate(data, size, block) {
  for (let by = 0; by < size; by += block) {
    for (let bx = 0; bx < size; bx += block) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = by; y < Math.min(size, by + block); y++) {
        for (let x = bx; x < Math.min(size, bx + block); x++) {
          const i = (y * size + x) * 4;
          const w = data[i + 3];
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += w; n++;
        }
      }
      const out = a > 0 ? [r / a, g / a, b / a, a / n] : [0, 0, 0, 0];
      for (let y = by; y < Math.min(size, by + block); y++) {
        for (let x = bx; x < Math.min(size, bx + block); x++) {
          const i = (y * size + x) * 4;
          data[i] = out[0]; data[i + 1] = out[1]; data[i + 2] = out[2]; data[i + 3] = out[3];
        }
      }
    }
  }
  return data;
}

// Quantize color to `levels` per channel and alpha to `alphaLevels` (hard
// edges: the faint tail of a glow drops out).
export function posterize(data, levels, alphaLevels = 4) {
  const q = (v, n) => Math.round((v / 255) * (n - 1)) * (255 / (n - 1));
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    const qa = a < 0.12 ? 0 : Math.max(1 / (alphaLevels - 1), Math.round(a * (alphaLevels - 1)) / (alphaLevels - 1));
    data[i + 3] = clamp255(qa * 255);
    if (qa === 0) {
      data[i] = data[i + 1] = data[i + 2] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) data[i + c] = clamp255(q(data[i + c], levels));
  }
  return data;
}

// Ink: empty pixels within `width` of a solid one (alpha >= 0.6) turn dark.
export function outline(data, size, width, ink) {
  const solid = new Uint8Array(size * size);
  for (let p = 0; p < size * size; p++) solid[p] = data[p * 4 + 3] >= 153 ? 1 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      if (data[p * 4 + 3] >= 64) continue;
      let near = false;
      for (let dy = -width; dy <= width && !near; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= size) continue;
        for (let dx = -width; dx <= width; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < size && solid[yy * size + xx]) {
            near = true;
            break;
          }
        }
      }
      if (near) {
        data[p * 4] = ink[0]; data[p * 4 + 1] = ink[1]; data[p * 4 + 2] = ink[2]; data[p * 4 + 3] = 230;
      }
    }
  }
  return data;
}

// ------------------------------------------------------------ guide

/** Markdown lines for the export guide's style section. */
export function styleGuideLines(style) {
  const s = STYLES[style.id] || STYLES[DEFAULT_STYLE];
  const others = STYLE_IDS.filter((x) => x !== style.id).map((x) => `${STYLES[x].label} (\`${x}\`)`).join(", ");
  const lines = [
    `## Style: ${s.label}`,
    "",
    `${s.about} ${style.from === "template" ? "This is the template's own style." : style.from === "chosen" ? "This style was chosen for this export; the template works in every style." : "This is the default style; the template works in every style."}`,
    "",
    `**The look:** ${s.look}`,
    "",
  ];
  if (style.notes) lines.push(`**Template notes:** ${style.notes}`, "");
  lines.push(
    "The sheets show the style's timing and composition and a hint of its look; the engine build gives the real look. Steps for the whole effect:",
    "",
    "**Unity**",
    "",
    ...s.unity.map((x) => `- ${x}`),
    "",
    "**Godot 4**",
    "",
    ...s.godot.map((x) => `- ${x}`),
    "",
    `Each layer below adds steps for this style where they differ. The same template exports in the other styles too: ${others}.`,
    "",
  );
  return lines;
}
