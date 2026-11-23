import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PORTING_FILE, collectSource, describeGroup, parseModule, portingMarkdown, renderFileName, renderMarkdown, renderSummary, unityBlend, unityState, uniformValue,
} from "../web/js/engine/renderinfo.js";

const root = new URL("../", import.meta.url);
const fetchText = (p) => readFile(new URL(p, root), "utf8");

test("blend modes map to Unity ShaderLab", () => {
  assert.equal(unityBlend({ blending: 2 }), "Blend SrcAlpha One");
  assert.equal(unityBlend({ blending: 1 }), "Blend SrcAlpha OneMinusSrcAlpha");
  assert.equal(unityBlend({ blending: 4 }), "Blend DstColor Zero");
  assert.equal(unityBlend({ blending: 0 }), "Blend Off");
  assert.equal(unityBlend({ blending: 5, blendSrc: 201, blendDst: 201, blendEquation: 102 }), "Blend One One\nBlendOp RevSub");
  assert.equal(unityState({ blending: 2, depthWrite: false, side: 2 }), "Blend SrcAlpha One\nZWrite Off\nZTest LEqual\nCull Off");
});

test("uniform values serialize", () => {
  const color = { isColor: true, getHexString: () => "ff8800" };
  assert.equal(uniformValue(color), "#ff8800");
  assert.equal(uniformValue(0.123456), 0.1235);
  assert.deepEqual(uniformValue({ isVector3: true, toArray: () => [1, 2, 3] }), [1, 2, 3]);
  assert.deepEqual(uniformValue({ isTexture: true, image: { width: 64, height: 32 } }).texture, "64x32");
});

test("describeGroup lists objects, dedupes materials and shaders", () => {
  const shader = { type: "ShaderMaterial", isShaderMaterial: true, blending: 2, transparent: true, depthWrite: false, vertexShader: "void main(){}", fragmentShader: "void main(){}", uniforms: { uTime: { value: 2 } } };
  const shader2 = { ...shader, uniforms: { uTime: { value: 3 } } };
  const basic = { type: "MeshBasicMaterial", blending: 1, color: { isColor: true, getHexString: () => "112233", getHex: () => 1 } };
  const geo = { type: "BufferGeometry", attributes: { position: { count: 12 }, uv: { count: 12 } } };
  const group = {
    name: "bolt#0",
    children: [
      { isMesh: true, name: "core", geometry: geo, material: shader, children: [] },
      { isMesh: true, name: "glow", geometry: geo, material: shader2, children: [] },
      { isPoints: true, geometry: geo, material: basic, children: [] },
      { isLight: true, type: "PointLight", intensity: 3, color: { isColor: true, getHexString: () => "ffffff" }, children: [] },
    ],
  };
  const d = describeGroup(group);
  assert.equal(d.objects.length, 3);
  assert.equal(d.materials.length, 3);
  assert.equal(d.shaders.length, 1, "same GLSL written once");
  assert.equal(d.materials[0].shader, d.materials[1].shader);
  assert.equal(d.materials[1].uniforms.uTime, 3);
  assert.equal(d.objects[2].kind, "Points");
  assert.equal(d.lights.length, 1);
  assert.match(renderSummary(d), /2 Mesh, 1 Points; additive\/normal blending; 1 custom shader/);
});

test("parseModule splits top-level declarations and imports", () => {
  const src = [
    'import { a, b as c } from "./x.js";',
    "// helper",
    "function h() { return a(); }",
    "",
    "/** The thing. */",
    "export class Thing extends Base {",
    "  go() { return h() + c; }",
    "}",
    "const K = 1;",
  ].join("\n");
  const m = parseModule(src);
  assert.deepEqual([...m.decls.keys()], ["h", "Thing", "K"]);
  assert.match(m.decls.get("h"), /^\/\/ helper\nfunction h/);
  assert.match(m.decls.get("Thing"), /^\/\*\* The thing/);
  assert.deepEqual(m.imports.get("c"), { from: "./x.js", name: "b" });
});

test("collectSource pulls a layer class and its helpers from the real engine", async () => {
  const src = await collectSource("web/js/engine/effect.js", "BoltLayer", fetchText);
  const names = src.decls.map((d) => d.name);
  assert.equal(names[0], "BoltLayer");
  assert.ok(names.includes("Layer"), "the base class");
  assert.ok(names.includes("boltSegments"));
  assert.ok(src.decls.some((d) => d.file !== "web/js/engine/effect.js"), "follows imports into other engine files");
  assert.ok(src.external.includes("three"));
  assert.ok(src.decls.every((d) => d.code.trim().length > 0));
  // Every layer type in the engine can be cut out.
  const { decls } = parseModule(await fetchText("web/js/engine/effect.js"));
  const types = decls.get("TYPES").match(/:\s*([A-Z]\w+Layer)/g).map((x) => x.replace(/[:\s]/g, ""));
  assert.ok(types.length >= 15);
  for (const t of types) assert.ok(decls.has(t), t);
});

test("renderMarkdown and portingMarkdown", async () => {
  const source = await collectSource("web/js/engine/effect.js", "GlowLayer", fetchText);
  const scene = describeGroup({ name: "g", children: [{ isSprite: true, geometry: { attributes: { position: { count: 4 } } }, material: { type: "SpriteMaterial", blending: 2, depthWrite: false }, children: [] }] });
  const md = renderMarkdown({ layer: { id: "halo", type: "glow" }, className: "GlowLayer", scene, source, sourceFile: "web/js/engine/effect.js", peak_ms: 420, seed: 7, params: { size: 1 } });
  assert.match(md, /# How SpellDirector drew `halo` \(glow\)/);
  assert.match(md, /Blend SrcAlpha One\nZWrite Off/);
  assert.match(md, /class GlowLayer extends Layer/);
  assert.match(md, /420 ms/);
  assert.equal(renderFileName("my layer"), "render/my-layer.md");
  const port = portingMarkdown({ templateId: "x", layers: [{ id: "halo", type: "glow", summary: "1 Sprite" }] });
  assert.match(port, /lerp\(a, b, t\)/);
  assert.match(port, /\[`halo`\]\(halo\.md\)/);
  assert.equal(PORTING_FILE, "render/PORTING.md");
});
