// "How we rendered it": for each layer, the export writes the code that drew
// it in the viewer (its layer class and every helper it uses, cut from the
// engine's own source), the live Three.js objects and materials at the
// layer's peak (blend modes, depth, uniforms, GLSL), and notes for porting
// all of it to Unity (HLSL, Shader Graph, VFX Graph) or another engine.
//
// Pure JavaScript, no Three.js: objects are read by duck typing, and source
// files come through a fetchText(path) callback, so Node can test it.

export const RENDER_DIR = "render";
export const PORTING_FILE = `${RENDER_DIR}/PORTING.md`;

/** The per-layer file: render/<layer id>.md. */
export function renderFileName(layerId) {
  return `${RENDER_DIR}/${String(layerId).replace(/[^A-Za-z0-9_.-]+/g, "-")}.md`;
}

// Three.js r169 constants, by value.
const BLENDINGS = { 0: "none", 1: "normal", 2: "additive", 3: "subtractive", 4: "multiply", 5: "custom" };
const SIDES = { 0: "front", 1: "back", 2: "double" };
const FACTORS = {
  200: "Zero", 201: "One", 202: "SrcColor", 203: "OneMinusSrcColor", 204: "SrcAlpha", 205: "OneMinusSrcAlpha",
  206: "DstAlpha", 207: "OneMinusDstAlpha", 208: "DstColor", 209: "OneMinusDstColor", 210: "SrcAlphaSaturate",
};
const EQUATIONS = { 100: "Add", 101: "Sub", 102: "RevSub", 103: "Min", 104: "Max" };

/**
 * A material's blend mode as Unity ShaderLab render state.
 * mat: { blending, premultipliedAlpha, blendSrc, blendDst, blendEquation }.
 */
export function unityBlend(mat) {
  const pm = !!mat.premultipliedAlpha;
  switch (mat.blending) {
    case 0: return "Blend Off";
    case 1: return pm ? "Blend One OneMinusSrcAlpha" : "Blend SrcAlpha OneMinusSrcAlpha";
    case 2: return pm ? "Blend One One" : "Blend SrcAlpha One";
    case 3: return pm ? "Blend Zero OneMinusSrcColor, Zero OneMinusSrcAlpha" : "Blend Zero OneMinusSrcColor";
    case 4: return pm ? "Blend Zero SrcColor, Zero SrcAlpha" : "Blend DstColor Zero";
    case 5: {
      const op = EQUATIONS[mat.blendEquation] || "Add";
      return `Blend ${FACTORS[mat.blendSrc] || "SrcAlpha"} ${FACTORS[mat.blendDst] || "OneMinusSrcAlpha"}${op === "Add" ? "" : `\nBlendOp ${op}`}`;
    }
    default: return "Blend SrcAlpha OneMinusSrcAlpha";
  }
}

/** Unity's Cull, ZWrite and ZTest lines for a material. */
export function unityState(mat) {
  const cull = mat.side === 2 ? "Cull Off" : mat.side === 1 ? "Cull Front" : "Cull Back";
  return [unityBlend(mat), `ZWrite ${mat.depthWrite === false ? "Off" : "On"}`, `ZTest ${mat.depthTest === false ? "Always" : "LEqual"}`, cull].join("\n");
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** A uniform's value as JSON (colors as hex, vectors as arrays, textures by size). */
export function uniformValue(v) {
  if (v == null) return null;
  if (typeof v === "number") return r4(v);
  if (typeof v === "boolean" || typeof v === "string") return v;
  if (v.isColor) return `#${v.getHexString()}`;
  if (v.isTexture) {
    const img = v.image || {};
    return { texture: img.width && img.height ? `${img.width}x${img.height}` : "texture", made: "procedurally, in the layer code" };
  }
  if (v.isMatrix3 || v.isMatrix4) return "matrix";
  if (v.isVector2 || v.isVector3 || v.isVector4 || v.isQuaternion) return v.toArray().map(r4);
  if (Array.isArray(v)) return v.length > 16 ? `array of ${v.length}` : v.map(uniformValue);
  if (ArrayBuffer.isView(v)) return `${v.constructor.name} of ${v.length}`;
  return String(v);
}

function objectKind(o) {
  if (o.isInstancedMesh) return "InstancedMesh";
  if (o.isPoints) return "Points";
  if (o.isLineSegments) return "LineSegments";
  if (o.isLine) return "Line";
  if (o.isSprite) return "Sprite";
  if (o.isMesh) return "Mesh";
  return o.type || "Object3D";
}

// What each kind of Three.js object usually becomes in Unity.
export const UNITY_FOR_KIND = {
  Points: "a Particle System or VFX Graph output of camera-facing quads (gl_PointSize becomes the particle size)",
  Mesh: "a MeshRenderer with the material below (a ribbon mesh: Trail/Line Renderer or a VFX Graph Particle Strip)",
  InstancedMesh: "Graphics.RenderMeshInstanced, or a VFX Graph Output Particle Mesh",
  Sprite: "a camera-facing quad (Particle System billboard, or a SpriteRenderer that faces the camera)",
  Line: "a LineRenderer",
  LineSegments: "a LineRenderer per segment, or a mesh with MeshTopology.Lines",
};

function textureNote(t) {
  if (!t) return null;
  const img = t.image || {};
  return img.width && img.height ? `${img.width}x${img.height} (drawn in code)` : "texture (drawn in code)";
}

/**
 * Describe one material. shaders: a Map from GLSL text to a shader id, shared
 * by a layer so the same program is written once.
 */
export function describeMaterial(mat, shaders) {
  const out = {
    type: mat.type,
    blending: BLENDINGS[mat.blending] ?? String(mat.blending),
    unity: unityState(mat),
    transparent: !!mat.transparent,
    depth_write: mat.depthWrite !== false,
    depth_test: mat.depthTest !== false,
    side: SIDES[mat.side] ?? "front",
  };
  if (mat.name) out.name = mat.name;
  if (mat.opacity !== undefined && mat.opacity !== 1) out.opacity = r4(mat.opacity);
  if (mat.color?.isColor) out.color = `#${mat.color.getHexString()}`;
  if (mat.map) out.map = textureNote(mat.map);
  if (mat.alphaMap) out.alpha_map = textureNote(mat.alphaMap);
  if (mat.vertexColors) out.vertex_colors = true;
  if (mat.isPointsMaterial) {
    out.size = r4(mat.size);
    out.size_attenuation = mat.sizeAttenuation !== false;
  }
  if (mat.emissive?.isColor && mat.emissive.getHex() !== 0) out.emissive = `#${mat.emissive.getHexString()}`;
  if (mat.roughness !== undefined) out.roughness = r4(mat.roughness);
  if (mat.metalness !== undefined) out.metalness = r4(mat.metalness);
  if (mat.isShaderMaterial || mat.isRawShaderMaterial) {
    const key = `${mat.vertexShader}\n/*--*/\n${mat.fragmentShader}`;
    if (!shaders.has(key)) shaders.set(key, { id: `shader_${shaders.size + 1}`, vertex: mat.vertexShader, fragment: mat.fragmentShader, raw: !!mat.isRawShaderMaterial });
    out.shader = shaders.get(key).id;
    out.uniforms = Object.fromEntries(Object.entries(mat.uniforms || {}).map(([k, u]) => [k, uniformValue(u?.value)]));
    if (mat.defines && Object.keys(mat.defines).length) out.defines = { ...mat.defines };
  }
  // A built-in material patched in code (onBeforeCompile): keep the patch.
  if (Object.prototype.hasOwnProperty.call(mat, "onBeforeCompile") && typeof mat.onBeforeCompile === "function") {
    out.on_before_compile = String(mat.onBeforeCompile);
  }
  return out;
}

/**
 * Walk a layer's Three.js group: every drawn object and light, with its
 * geometry and material. Returns { objects, materials, shaders, lights }.
 */
export function describeGroup(group) {
  const objects = [];
  const materials = [];
  const matIndex = new Map();
  const shaderMap = new Map();
  const lights = [];
  const walk = (o, path) => {
    const name = o.name ? `${path}/${o.name}` : path;
    if (o.isLight) {
      lights.push({ type: o.type, color: o.color?.isColor ? `#${o.color.getHexString()}` : undefined, intensity: r4(o.intensity ?? 0), distance: o.distance !== undefined ? r4(o.distance) : undefined, decay: o.decay });
    }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    if (mats.length) {
      const ids = mats.map((m) => {
        if (!matIndex.has(m)) {
          matIndex.set(m, materials.length);
          materials.push(describeMaterial(m, shaderMap));
        }
        return matIndex.get(m);
      });
      const g = o.geometry || {};
      const pos = g.attributes?.position;
      const obj = {
        kind: objectKind(o),
        name,
        geometry: g.type || "BufferGeometry",
        vertices: pos ? pos.count : 0,
        attributes: Object.keys(g.attributes || {}),
        material: ids.length === 1 ? ids[0] : ids,
        visible: o.visible !== false,
        unity: UNITY_FOR_KIND[objectKind(o)] || "a MeshRenderer",
      };
      if (g.index) obj.indices = g.index.count;
      if (g.parameters && Object.keys(g.parameters).length) obj.geometry_params = Object.fromEntries(Object.entries(g.parameters).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, r4(v)]));
      if (o.isInstancedMesh) obj.instances = o.count;
      if (o.renderOrder) obj.render_order = o.renderOrder;
      if (o.frustumCulled === false) obj.frustum_culled = false;
      objects.push(obj);
    }
    (o.children || []).forEach((c, i) => walk(c, `${name}/${c.name || `${objectKind(c)}${i}`}`));
  };
  walk(group, group.name || "layer");
  return { objects, materials, shaders: [...shaderMap.values()], lights };
}

// ------------------------------------------------------------ source slices

const DECL = /^(?:export\s+)?(?:async\s+)?(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/;

/**
 * Split a module's source into its top-level declarations:
 * { decls: Map(name -> code, with the comment just above it), imports: Map(local name -> { from, name }) }.
 */
export function parseModule(src) {
  const lines = String(src).split("\n");
  const imports = new Map();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of String(src).matchAll(importRe)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      if (!bits[0]) continue;
      imports.set((bits[1] || bits[0]).trim(), { from: m[2], name: bits[0].trim() });
    }
  }
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(DECL);
    if (m) starts.push({ i, name: m[1] });
  });
  const decls = new Map();
  starts.forEach((s, k) => {
    // The comment block right above the declaration belongs to it.
    let a = s.i;
    while (a > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[a - 1])) a--;
    let b = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    while (b > s.i + 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[b - 1])) b--;
    while (b > s.i + 1 && lines[b - 1].trim() === "") b--;
    // Stop at the end of a top-level import/export block or comment banner.
    const body = lines.slice(a, b);
    const end = body.findIndex((l, j) => j > s.i - a && /^\/\/ -{4,}/.test(l));
    decls.set(s.name, (end > 0 ? body.slice(0, end) : body).join("\n").replace(/\s+$/, ""));
  });
  return { decls, imports };
}

// Identifiers a piece of code mentions (comments stripped).
function mentions(code) {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return new Set(bare.match(/[A-Za-z_$][\w$]*/g) || []);
}

function resolvePath(from, rel) {
  if (!rel.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const p of rel.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

// The scene around the spell (stage, caster rig, gestures): left out of the
// per-layer code. They place anchors; the caster rig export carries them.
export const SKIP_FILES = ["web/js/engine/stage.js", "web/js/engine/gesture.js", "web/js/engine/rig.js"];

/**
 * The code that draws something: the named declaration in `file` and every
 * top-level declaration it uses, followed across local imports.
 * fetchText(path) -> Promise<string> (paths like "js/engine/effect.js").
 * Returns [{ file, name, code }] in a reading order (the entry first, then
 * same-file helpers, then other files), and { external: ["three", ...] }.
 */
export async function collectSource(file, name, fetchText, { maxDecls = 200, skip = SKIP_FILES } = {}) {
  const mods = new Map();
  const mod = async (f) => {
    if (!mods.has(f)) mods.set(f, fetchText(f).then(parseModule).catch(() => null));
    return mods.get(f);
  };
  const seen = new Set();
  const out = [];
  const external = new Set();
  const skipped = new Set();
  const queue = [[file, name]];
  while (queue.length && out.length < maxDecls) {
    const [f, n] = queue.shift();
    const key = `${f}#${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = await mod(f);
    if (!m) continue;
    const code = m.decls.get(n);
    if (code == null) continue;
    out.push({ file: f, name: n, code });
    for (const id of mentions(code)) {
      if (id === n) continue;
      if (m.decls.has(id)) queue.push([f, id]);
      else if (m.imports.has(id)) {
        const imp = m.imports.get(id);
        const p = resolvePath(f, imp.from);
        if (p && skip.includes(p)) skipped.add(`${imp.name} (${p})`);
        else if (p) queue.push([p, imp.name]);
        else external.add(imp.from);
      }
    }
  }
  if (/\bTHREE\./.test(out.map((d) => d.code).join("\n"))) external.add("three");
  // Reading order: the entry, its own file's helpers, then other files.
  const first = out.slice(0, 1);
  const same = out.slice(1).filter((d) => d.file === file);
  const other = out.slice(1).filter((d) => d.file !== file).sort((a, b) => a.file.localeCompare(b.file));
  return { decls: [...first, ...same, ...other], external: [...external], skipped: [...skipped].sort(), truncated: out.length >= maxDecls };
}

// ------------------------------------------------------------ the files

const fence = (lang, code) => {
  const ticks = /```/.test(code) ? "````" : "```";
  return [`${ticks}${lang}`, String(code).replace(/\s+$/, ""), ticks];
};

/**
 * The markdown for one layer. info: { layer (manifest layer entry or
 * template layer def), className, peak_ms, params, scene: describeGroup(...),
 * source: collectSource(...) result, sourceFile }.
 */
export function renderMarkdown(info) {
  const { layer, className, scene, source } = info;
  const L = [];
  const add = (...xs) => L.push(...xs);
  add(`# How SpellDirector drew \`${layer.id}\` (${layer.type})`, "");
  add(
    "This is the viewer's own code for this layer, cut from the SpellDirector engine (Three.js r169, WebGL), plus a snapshot of the objects and materials it made. Use it as the recipe: port what it does, not line for line. See [PORTING.md](PORTING.md) for how each piece maps to Unity (HLSL, Shader Graph, VFX Graph) and other engines.",
    "",
    `- Class \`${className}\` in \`${info.sourceFile}\`. Every layer is a pure function of time: \`update(t)\` sets everything from the layer's time \`t\` (ms) and the seed, with no state carried between frames. Port \`update(t)\` as your per-frame update, with \`t = (now - spell start) × 1000\`.`,
    `- Snapshot taken at **${Math.round(info.peak_ms)} ms** (the layer's strongest moment), seed ${info.seed}.`,
    "- Randomness: `this.rng(...)` is a seeded generator (same seed, same spell). Any seeded RNG will do; keep the draws per element so the effect is stable frame to frame.",
    "",
  );
  if (info.params && Object.keys(info.params).length) {
    add("## Settings it was drawn with", "", ...fence("json", JSON.stringify(info.params, null, 2)), "");
  }

  add("## What it made (Three.js objects at the snapshot)", "");
  if (!scene.objects.length && !scene.lights.length) {
    add("Nothing drawn: this layer works through the engine directly (light, camera shake, sound, screen flash), see its code below and the guide.", "");
  } else {
    if (scene.objects.length) {
      add("| Object | Kind | Geometry | Vertices | Material | Becomes in Unity |", "|---|---|---|---|---|---|");
      for (const o of scene.objects.slice(0, 60)) {
        add(`| \`${o.name}\` | ${o.kind}${o.instances ? ` ×${o.instances}` : ""} | ${o.geometry} | ${o.vertices} | ${Array.isArray(o.material) ? o.material.map((m) => `#${m}`).join(", ") : `#${o.material}`} | ${o.unity} |`);
      }
      if (scene.objects.length > 60) add(`| … | ${scene.objects.length - 60} more | | | | |`);
      add("");
    }
    for (const l of scene.lights) add(`- Light: ${l.type} ${l.color || ""} intensity ${l.intensity}${l.distance !== undefined ? `, range ${l.distance}` : ""}.`);
    if (scene.lights.length) add("");
  }

  if (scene.materials.length) {
    add("## Materials", "");
    scene.materials.forEach((m, i) => {
      add(`### Material #${i}: ${m.type}${m.shader ? ` (${m.shader})` : ""}`, "");
      const bits = [`blending **${m.blending}**`, m.transparent ? "transparent" : "opaque", `depth write ${m.depth_write ? "on" : "off"}`, `depth test ${m.depth_test ? "on" : "off"}`, `${m.side} side`];
      if (m.color) bits.push(`color ${m.color}`);
      if (m.opacity !== undefined) bits.push(`opacity ${m.opacity}`);
      if (m.map) bits.push(`texture ${m.map}`);
      if (m.vertex_colors) bits.push("vertex colors");
      if (m.size !== undefined) bits.push(`point size ${m.size}${m.size_attenuation ? " (shrinks with distance)" : ""}`);
      add(`- ${bits.join(", ")}.`, "- Unity render state:", "", ...fence("", m.unity), "");
      if (m.uniforms) add("- Uniforms at the snapshot (the layer code sets them every frame):", "", ...fence("json", JSON.stringify(m.uniforms, null, 2)), "");
      if (m.defines) add(`- Defines: ${Object.entries(m.defines).map(([k, v]) => `${k}=${v}`).join(", ")}.`, "");
      if (m.on_before_compile) add("- A built-in material patched in code (`onBeforeCompile`); the patch:", "", ...fence("js", m.on_before_compile), "");
    });
  }

  if (scene.shaders.length) {
    add("## Shaders (GLSL ES 3.0, as Three.js compiles them)", "");
    add("Three.js adds its built-ins before these: `projectionMatrix`, `modelViewMatrix`, `modelMatrix`, `viewMatrix`, `cameraPosition`, and the attributes `position`, `uv`, `normal` (and `color` with vertex colors). PORTING.md has their Unity names.", "");
    for (const s of scene.shaders) {
      add(`### ${s.id}${s.raw ? " (raw: no built-ins added)" : ""}`, "", "Vertex:", "", ...fence("glsl", s.vertex), "", "Fragment:", "", ...fence("glsl", s.fragment), "");
    }
  }

  add("## The code", "");
  if (!source?.decls?.length) {
    add("The source could not be read when this export was made. It is in the SpellDirector repository, `web/js/engine/`.", "");
  } else {
    add(`\`${className}\` first, then every helper it uses from the same file, then helpers from other engine files. \`Layer\` is the base class every layer extends (param lookup, timing window, seeded RNG, anchors). External libraries: ${source.external.length ? source.external.map((x) => `\`${x}\``).join(", ") : "none"}.${source.skipped?.length ? ` Left out (scene placement: where the hands, target and ground are; the caster rig timeline gives those points): ${source.skipped.map((x) => `\`${x}\``).join(", ")}.` : ""}${source.truncated ? " (Cut short: the rest is in the repository.)" : ""}`, "");
    let file = null;
    for (const d of source.decls) {
      if (d.file !== file) {
        file = d.file;
        add(`### \`${file}\``, "");
      }
      add(...fence("js", d.code), "");
    }
  }
  return `${L.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** The porting cheat sheet (render/PORTING.md). */
export function portingMarkdown({ templateId, layers = [] } = {}) {
  const L = [
    "# Porting SpellDirector's rendering to your engine",
    "",
    `Each \`render/<layer>.md\` in this export${templateId ? ` (\`${templateId}\`)` : ""} holds the code that drew one layer in SpellDirector's viewer (Three.js r169 on WebGL 2), a snapshot of the objects and materials it made, their blend state already written as Unity ShaderLab, and the GLSL of every custom shader. This page says how those pieces map to Unity and other engines.`,
    "",
    "Use the code as a recipe, not a spec: it was written to look right in a browser preview from four fixed cameras. Match the sprite sheets (timing, footprint, color) first; the code tells you how we got there.",
    "",
    "## How the viewer is put together",
    "",
    "- One `Effect` holds the spell's layers. Each layer is a class with a Three.js `group` and an `update(t)` that sets every vertex, uniform, color and visibility from the layer's time `t` (ms), its params (`this.p(name, t)`, with keyframes already applied) and a seeded RNG. Nothing is carried from frame to frame, so you can scrub to any time.",
    "- `this.window` is when the layer is on, `intensityAt(t)` its fade in and out, `anchorPos()` where it sits (the caster's hand, the target, the ground...). Positions are in SpellDirector units: 1 unit = 1.8 m (one caster height), +Y up; the caster rig's timeline JSON gives the same points in Unity space.",
    "- After the layers, `engine/post.js` adds bloom (UnrealBloomPass) and the style's color grade. In Unity, put **Bloom** on a URP Volume (threshold about 0.8, intensity 1–2) and keep the layer colors HDR (emissive above 1) so they bloom the same way.",
    "",
    "## Three.js objects to Unity",
    "",
    "| Three.js | Unity |",
    "|---|---|",
    ...Object.entries(UNITY_FOR_KIND).map(([k, v]) => `| \`${k}\` | ${v} |`),
    "| `RibbonMesh` (our camera-facing strip along a path) | Trail Renderer or Line Renderer with a gradient; for many strands a VFX Graph Particle Strip |",
    "| `PointLight` | Point Light (URP) with the same color; intensity is in different units, match by eye |",
    "| `CanvasTexture` (soft dots, clouds, decal art) | A small texture: make it once (the decal and smoke PNGs in this export are these) or compute it in the shader |",
    "| `group.visible`, `renderOrder` | `SetActive`, sorting order / render queue (`Transparent+n`) |",
    "",
    "## Blend modes",
    "",
    "| Three.js | Unity ShaderLab | Shader Graph / VFX Graph |",
    "|---|---|---|",
    "| `AdditiveBlending` | `Blend SrcAlpha One` | Surface Transparent, Blending Mode **Additive** |",
    "| `NormalBlending` | `Blend SrcAlpha OneMinusSrcAlpha` | Transparent, **Alpha** |",
    "| `MultiplyBlending` | `Blend DstColor Zero` | Transparent, **Multiply** |",
    "| `depthWrite: false` | `ZWrite Off` | Depth Write off (the default for transparent) |",
    "| `depthTest: false` | `ZTest Always` | Depth Test **Always** |",
    "| `side: DoubleSide` | `Cull Off` | Two Sided on / Render Face **Both** |",
    "",
    "## GLSL to HLSL",
    "",
    "| GLSL (Three.js) | HLSL (Unity) |",
    "|---|---|",
    "| `vec2/3/4`, `mat3/4` | `float2/3/4`, `float3x3/4x4` |",
    "| `mix(a, b, t)` | `lerp(a, b, t)` |",
    "| `fract(x)` | `frac(x)` |",
    "| `mod(x, y)` | `x - y * floor(x / y)` (HLSL `fmod` differs for negatives) |",
    "| `atan(y, x)` | `atan2(y, x)` |",
    "| `texture2D(t, uv)` / `texture(t, uv)` | `SAMPLE_TEXTURE2D(_Tex, sampler_Tex, uv)` (URP) or `tex2D(_Tex, uv)` |",
    "| `m * v` | `mul(m, v)` |",
    "| `gl_FragColor` / `out vec4` | the fragment function's `return float4(...)` |",
    "| `gl_PointCoord` | the particle quad's `uv` |",
    "| `gl_PointSize` | particle size (a Particle System or VFX Graph sets it) |",
    "| `varying` / `in` / `out` | fields of the `Varyings` struct |",
    "| `uniform float uTime;` | a material property (`_Time` in the Properties block), set from a script with `material.SetFloat`, or use Unity's `_Time.y` |",
    "| `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` | `TransformObjectToHClip(input.positionOS.xyz)` (URP) / `UnityObjectToClipPos(v.vertex)` |",
    "| `modelMatrix` / `viewMatrix` / `cameraPosition` | `UNITY_MATRIX_M` / `UNITY_MATRIX_V` / `_WorldSpaceCameraPos` |",
    "| `smoothstep`, `clamp`, `pow`, `exp`, `dot`, `normalize`, `length` | same names |",
    "| `discard` | `discard` (or `clip(x)`) |",
    "",
    "Shader Graph: put a GLSL body in a **Custom Function** node (after converting it with the table above), with the uniforms as Blackboard properties of the same names. VFX Graph: do the per-particle math from `update(t)` in Update Particle blocks, and the fragment math in a Shader Graph output.",
    "",
    "## Porting a layer, step by step",
    "",
    "1. Read the layer's `render/<layer>.md`: the object table says what to make (particles, ribbons, meshes, light), the materials say how they blend, the GLSL says how each pixel is shaded.",
    "2. Make the objects under the layer's own child GameObject (its on/off switch, see the guide) at the anchor point.",
    "3. Write one script per layer (or a VFX Graph) whose update does what `update(t)` does: same params, same curves, same timing window. Read params from the export's template JSON so a new seed or template still works.",
    "4. Port each custom shader with the tables above; set its uniforms every frame from the script, as the layer code does.",
    "5. Solo the layer and compare it with its sprite sheet at the same moments and view. Then add the next layer.",
    "",
    "## Common porting traps",
    "",
    "- **Aim.** The viewer aims a beam from the hand at the target's chest height (or straight across at hand height). Games often aim at the target's pivot, which is at its feet: then the far end dives into the ground. Aim at the pivot plus about half the target's height, and port a beam's `ground_clearance_px` as written (`groundLift` in `engine/beamground.js` tilts the points up before the ribbon is built).",
    "- **Ribbons face the camera.** `RibbonMesh` widens sideways to the view in its vertex shader, so seen from a low angle its width is vertical and can reach below the centre line. A flat card or a Line Renderer with fixed alignment shows a hard edge and a repeating texture; use View alignment and the layer's fragment shader (noise stretched along the stream, sides feathered) rather than a tiled flame texture.",
    "- **Scale.** Pixel params (`*_px`) are template pixels: multiply by 0.01 for SpellDirector units, then by 1.8 for metres. Sprites and puffs that look too far off a beam's core in-game are usually a unit slip here.",
    "",
    "## Godot 4 in one line",
    "",
    "Godot's shading language is GLSL-like: most bodies paste across with `COLOR`/`ALPHA`/`ALBEDO`/`EMISSION` outputs and `render_mode blend_add, unshaded, depth_draw_never, cull_disabled` in place of the Unity state lines. Points become GPUParticles3D, ribbons become a trail-enabled GPUParticles3D or an ImmediateMesh.",
    "",
  ];
  if (layers.length) {
    L.push("## Layers in this export", "", ...layers.map((l) => `- [\`${l.id}\`](${renderFileName(l.id).slice(RENDER_DIR.length + 1)}) (${l.type}): ${l.summary}`), "");
  }
  return L.join("\n");
}

/** One line for a layer's render summary: what it drew and how it blends. */
export function renderSummary(scene) {
  if (!scene.objects.length) return scene.lights.length ? "a light" : "no meshes (engine-side effect)";
  const kinds = {};
  for (const o of scene.objects) kinds[o.kind] = (kinds[o.kind] || 0) + 1;
  const blends = [...new Set(scene.materials.map((m) => m.blending))];
  const parts = Object.entries(kinds).map(([k, n]) => `${n} ${k}`);
  return `${parts.join(", ")}; ${blends.join("/")} blending${scene.shaders.length ? `; ${scene.shaders.length} custom shader${scene.shaders.length > 1 ? "s" : ""}` : ""}`;
}
