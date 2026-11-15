// Shader intent: how an engine should build each layer's look. Pure, so the
// export guide and Node tests share it. A template layer may carry a `shader`
// object (docs/vocabulary.md section 11); layers without one get a sensible
// default per layer type, marked as a guess.

export const HOW_TO_USE = [
  "These sprite sheets are a reference, not the effect itself. They show timing, layering, composition, motion and palette from four cameras.",
  "Do not copy them pixel for pixel into a game, and an AI model (Claude, GPT, ...) should not treat them as literal instructions. Rebuild each layer in the engine with shaders and particles: the `shader` intent of each layer (material, noise, flow, distortion, fresnel, dissolve, emissive) says what the magic should feel like, and the beats and layer timings say when.",
  "Use the frames to check your rebuild: same beats, same order, same footprint, same colors. Use them directly only for quick prototypes, flipbook-style games, or as a texture source (for example a bolt shape or a decal).",
];

// Per-layer-type defaults, used when a template layer has no shader intent.
export const DEFAULT_SHADER = {
  bolt: { technique: "ribbon", material: "ionized", noise: { type: "ridged", scale: 6, speed: 4, contrast: 0.8 }, flow: { direction: "along_path", speed: 6 }, emissive: { hdr: 5, falloff: "exponential", core_ratio: 0.3 }, lighting: "emits_light" },
  beam: { technique: "ribbon", material: "plasma", noise: { type: "fbm", scale: 3, speed: 3, contrast: 0.6 }, flow: { direction: "along_path", speed: 5 }, emissive: { hdr: 4, falloff: "gaussian", core_ratio: 0.35 }, lighting: "emits_light" },
  crackle: { technique: "ribbon", material: "ionized", noise: { type: "ridged", scale: 10, speed: 8, contrast: 0.9 }, emissive: { hdr: 3, falloff: "hard", core_ratio: 0.4 }, lighting: "unlit" },
  glow: { technique: "procedural", material: "ethereal", noise: { type: "simplex", scale: 1.5, speed: 0.5, contrast: 0.2 }, emissive: { hdr: 2, falloff: "gaussian", core_ratio: 0.1 }, lighting: "unlit" },
  flash: { technique: "procedural", material: "ethereal", emissive: { hdr: 6, falloff: "gaussian", core_ratio: 0.2 }, lighting: "emits_light" },
  orb: { technique: "procedural", material: "plasma", noise: { type: "fbm", scale: 3, speed: 1.5, contrast: 0.5 }, flow: { direction: "swirl", speed: 1 }, fresnel: 0.6, emissive: { hdr: 3, falloff: "soft", core_ratio: 0.35 }, lighting: "emits_light" },
  sparks: { technique: "particles", material: "ionized", emissive: { hdr: 4, falloff: "hard", core_ratio: 0.6 }, lighting: "unlit" },
  ring: { technique: "procedural", material: "ethereal", noise: { type: "simplex", scale: 4, speed: 1, contrast: 0.3 }, flow: { direction: "outward", speed: 3 }, distortion: 0.2, emissive: { hdr: 2, falloff: "soft", core_ratio: 0.2 }, lighting: "unlit" },
  decal: { technique: "decal", material: "ashen", noise: { type: "fbm", scale: 4, speed: 0, contrast: 0.6 }, dissolve: { pattern: "fbm", edge_width: 0.15, edge_color: "primary" }, lighting: "lit" },
  smoke: { technique: "particles", material: "smoky", noise: { type: "curl", scale: 1.5, speed: 0.6, contrast: 0.5 }, flow: { direction: "upward", speed: 0.4 }, dissolve: { pattern: "fbm", edge_width: 0.3 }, lighting: "lit" },
  light: { technique: "light", lighting: "emits_light" },
};

const NO_SHADER = new Set(["sound_cue", "camera_shake"]);

// The layer's shader intent, plus whether it came from the template.
export function shaderFor(layer) {
  if (NO_SHADER.has(layer.type)) return null;
  if (layer.shader) return { ...layer.shader, from_template: true };
  const d = DEFAULT_SHADER[layer.type];
  return d ? { ...structuredClone(d), from_template: false } : { technique: "procedural", from_template: false };
}

const NOISE_WORDS = {
  perlin: "smooth Perlin noise",
  simplex: "smooth simplex noise",
  fbm: "layered fBm noise (several octaves)",
  ridged: "ridged noise (sharp bright creases)",
  voronoi: "Voronoi / cellular noise",
  curl: "curl noise (swirling, divergence-free)",
  streaks: "stretched streak noise",
};

// One plain-language line describing the intent.
export function describeShader(sh) {
  if (!sh) return "";
  const bits = [];
  if (sh.material) bits.push(`${sh.material} material`);
  if (sh.technique) bits.push(`built as ${sh.technique.replace("_", " ")}`);
  if (sh.noise && sh.noise.type !== "none") bits.push(`${NOISE_WORDS[sh.noise.type] || sh.noise.type}${sh.noise.scale ? ` at scale ${sh.noise.scale}` : ""}${sh.noise.speed ? `, moving ${sh.noise.speed} u/s` : ""}`);
  if (sh.flow && sh.flow.direction !== "none") bits.push(`flows ${sh.flow.direction.replace("_", " ")}${sh.flow.speed ? ` at ${sh.flow.speed} u/s` : ""}`);
  if (sh.distortion) bits.push(`distortion ${sh.distortion}`);
  if (sh.fresnel) bits.push(`fresnel rim ${sh.fresnel}`);
  if (sh.dissolve) bits.push(`dissolves with ${sh.dissolve.pattern || "noise"}${sh.dissolve.edge_width ? `, edge ${sh.dissolve.edge_width}` : ""}${sh.dissolve.edge_color ? ` in ${sh.dissolve.edge_color}` : ""}`);
  if (sh.emissive) bits.push(`emissive HDR ×${sh.emissive.hdr ?? 1}${sh.emissive.falloff ? `, ${sh.emissive.falloff} falloff` : ""}${sh.emissive.core_ratio ? `, core ${Math.round(sh.emissive.core_ratio * 100)}%` : ""}`);
  if (sh.lighting) bits.push(sh.lighting.replace("_", " "));
  return bits.join("; ");
}

const UNITY_TECH = {
  ribbon: "a Line Renderer or VFX Graph strip (Output ParticleStrip Quad) along the path",
  particles: "a VFX Graph (or Particle System) emitter",
  procedural: "a camera-facing quad or mesh with a Shader Graph material",
  flipbook: "a VFX Graph Output Particle Quad with Flipbook UV mode",
  mesh: "a mesh with a Shader Graph material",
  decal: "a URP/HDRP Decal Projector with a Shader Graph Decal material",
  light: "a Point Light (URP: Light 2D or real-time point light)",
  post_process: "a Volume override or full-screen pass",
};

const GODOT_TECH = {
  ribbon: "a MeshInstance3D strip or Line2D, or a GPUParticles3D trail (Ribbon)",
  particles: "GPUParticles3D/2D with a ParticleProcessMaterial",
  procedural: "a billboard QuadMesh with a spatial (or canvas_item) ShaderMaterial",
  flipbook: "GPUParticles with a CanvasItemMaterial / StandardMaterial3D using Particles Anim",
  mesh: "a MeshInstance3D with a ShaderMaterial",
  decal: "a Decal node (albedo + emission textures driven by a script)",
  light: "an OmniLight3D (2D: PointLight2D)",
  post_process: "a WorldEnvironment glow / full-screen ColorRect shader",
};

const UNITY_NOISE = { perlin: "Gradient Noise", simplex: "Simple Noise", fbm: "Gradient Noise summed over 3-4 octaves", ridged: "1 - abs(Gradient Noise), sharpened with Power", voronoi: "Voronoi", curl: "a curl-noise texture or VFX Graph Turbulence", streaks: "Gradient Noise with UVs stretched along the flow" };
const GODOT_NOISE = { perlin: "a NoiseTexture2D (FastNoiseLite Perlin)", simplex: "a NoiseTexture2D (Simplex Smooth)", fbm: "a NoiseTexture2D with Fractal FBM", ridged: "a NoiseTexture2D with Fractal Ridged", voronoi: "a NoiseTexture2D (Cellular)", curl: "turbulence in ParticleProcessMaterial or a curl-noise texture", streaks: "a NoiseTexture2D sampled with stretched UVs" };

// Short per-engine build steps for a layer.
export function engineRecipe(layer, sh, blend) {
  if (!sh) return null;
  const unity = [];
  const godot = [];
  const tech = sh.technique || "procedural";
  unity.push(`Build with ${UNITY_TECH[tech] || UNITY_TECH.procedural}.`);
  godot.push(`Build with ${GODOT_TECH[tech] || GODOT_TECH.procedural}.`);
  if (tech !== "light") {
    const add = blend === "add" || blend === "screen";
    unity.push(`Material: ${sh.lighting === "lit" ? "Lit" : "Unlit"} Shader Graph, Surface ${blend === "alpha" || blend === "multiply" ? "Transparent, Blend Alpha" : "Transparent, Blend Additive"}${blend === "multiply" ? " (or Multiply)" : ""}.`);
    godot.push(`Shader: \`render_mode ${add ? "blend_add" : blend === "multiply" ? "blend_mul" : "blend_mix"}${sh.lighting === "lit" ? "" : ", unshaded"}\`.`);
  }
  if (sh.noise && sh.noise.type && sh.noise.type !== "none") {
    unity.push(`Noise: ${UNITY_NOISE[sh.noise.type] || sh.noise.type}, scale ~${sh.noise.scale ?? 1} per unit, offset by Time × ${sh.noise.speed ?? 0}; multiply into alpha${sh.noise.contrast ? ` with contrast ${sh.noise.contrast}` : ""}.`);
    godot.push(`Noise: ${GODOT_NOISE[sh.noise.type] || sh.noise.type}, UV × ${sh.noise.scale ?? 1}, scrolled by TIME × ${sh.noise.speed ?? 0}.`);
  }
  if (sh.flow && sh.flow.direction && sh.flow.direction !== "none") {
    unity.push(`Flow: scroll UVs ${sh.flow.direction.replace("_", " ")} (Tiling And Offset with Time × ${sh.flow.speed ?? 1}).`);
    godot.push(`Flow: \`UV += dir * TIME * ${sh.flow.speed ?? 1}\` (${sh.flow.direction.replace("_", " ")}).`);
  }
  if (sh.distortion) {
    unity.push(`Distortion ${sh.distortion}: offset Scene Color UVs by the noise (URP: Opaque Texture on; HDRP: Distortion pass).`);
    godot.push(`Distortion ${sh.distortion}: sample \`hint_screen_texture\` at SCREEN_UV + noise × ${sh.distortion}.`);
  }
  if (sh.fresnel) {
    unity.push(`Rim: Fresnel Effect node (power ~${Math.max(1, Math.round((1 - sh.fresnel) * 5))}) added to emission.`);
    godot.push(`Rim: \`pow(1.0 - dot(NORMAL, VIEW), ${Math.max(1, Math.round((1 - sh.fresnel) * 5))}.0)\` added to EMISSION.`);
  }
  if (sh.dissolve) {
    unity.push(`Dissolve: Step/Smoothstep the ${sh.dissolve.pattern || "noise"} against the fade (Alpha Clip), with a ${sh.dissolve.edge_width ?? 0.1} wide glowing edge${sh.dissolve.edge_color ? ` in the ${sh.dissolve.edge_color} color` : ""}.`);
    godot.push(`Dissolve: \`smoothstep(fade, fade + ${sh.dissolve.edge_width ?? 0.1}, noise)\` for ALPHA, edge band to EMISSION.`);
  }
  if (sh.emissive) {
    unity.push(`Emission: color × ${sh.emissive.hdr ?? 1} (HDR) so Bloom picks it up${sh.emissive.falloff ? `; ${sh.emissive.falloff} falloff from the center line` : ""}.`);
    godot.push(`Emission: EMISSION = color × ${sh.emissive.hdr ?? 1}; turn on Glow in the WorldEnvironment.`);
  }
  if (sh.lighting === "emits_light" && tech !== "light") {
    unity.push("Add a small point light that follows the layer's intensity, or rely on the template's light layer.");
    godot.push("Add an OmniLight3D/PointLight2D that follows the layer's intensity, or use the template's light layer.");
  }
  return { unity, godot };
}
