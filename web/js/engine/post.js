// Post-processing shared by the viewer and the sprite exporter: the scene is
// drawn into an HDR render target (so stacked additive light can go past 1),
// bloomed, then written to the canvas in sRGB. Bloom only picks up bright
// pixels, so the ground and stand-ins stay crisp while bolt cores glow.
//
// Rendering stays a pure function of what is drawn: the bloom has no memory
// between frames.

import * as THREE from "three";
import { UnrealBloomPass } from "../../vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../../vendor/postprocessing/OutputPass.js";
import { FullScreenQuad } from "../../vendor/postprocessing/Pass.js";

// The style's grade, after bloom: saturation, then (toon, pixel art) chunky
// pixels, ink edges and posterized color. Works on the linear HDR image.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    res: { value: new THREE.Vector2(1, 1) },
    saturation: { value: 1 },
    posterize: { value: 0 },
    outline: { value: 0 },
    block: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 res;
uniform float saturation;
uniform float posterize;
uniform float outline;
uniform float block;
varying vec2 vUv;
float lumAt(vec2 uv) { vec3 c = texture2D(tDiffuse, uv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return pow(l / (1.0 + l), 0.4545); }
void main() {
  vec2 uv = vUv;
  if (block > 1.0) uv = (floor(uv * res / block) + 0.5) * block / res;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(0.0), mix(vec3(l), c, saturation));
  if (outline > 0.0) {
    vec2 px = max(block, 1.5) / res;
    float gx = lumAt(uv + vec2(px.x, 0.0)) - lumAt(uv - vec2(px.x, 0.0));
    float gy = lumAt(uv + vec2(0.0, px.y)) - lumAt(uv - vec2(0.0, px.y));
    c *= 1.0 - outline * 0.85 * smoothstep(0.1, 0.3, length(vec2(gx, gy)));
  }
  if (posterize > 0.0) {
    // Band the brightness, keep the hue: flat cel steps without greying darks.
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float g = pow(min(L, 1.0), 0.4545);
    float q = floor(g * posterize + 0.5) / posterize;
    c = L > 1e-4 ? c * (pow(q, 2.2) + max(L - 1.0, 0.0)) / L : c;
  }
  gl_FragColor = vec4(c, 1.0);
}`,
};

export const BLOOM = { strength: 0.6, radius: 0.3, threshold: 0.7 };

export class Post {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled = opts.bloom !== false;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: opts.samples ?? 4,
    });
    const b = { ...BLOOM, ...(opts.settings || {}) };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), b.strength, b.radius, b.threshold);
    this.output = new OutputPass();
    this.graded = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.grade = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(GradeShader.uniforms),
      vertexShader: GradeShader.vertexShader,
      fragmentShader: GradeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    }));
    this.view = null;
    this.toneMap = !!opts.toneMap;
    this.output.renderToScreen = true;
    this.width = 0;
    this.height = 0;
  }

  // Size in drawing-buffer pixels.
  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.target.setSize(w, h);
    this.graded.setSize(w, h);
    this.bloom.setSize(w, h);
    // Blur levels smaller than a few pixels show up as blocky squares in small
    // frames (sprite export cells): leave them out.
    const tints = this.bloom.compositeMaterial.uniforms.bloomTintColors.value;
    tints.forEach((c, i) => c.setScalar(Math.min(w, h) / 2 ** (i + 1) >= 24 ? 1 : 0));
  }

  /**
   * Use a style's look (engine/style.js `view`): bloom settings, and in the
   * viewer (toneMap: true) its tone mapping and grade. null = the default.
   */
  setStyle(view) {
    this.view = view || null;
    const b = { ...BLOOM, ...(view?.bloom || {}) };
    this.bloom.strength = b.strength;
    this.bloom.radius = b.radius;
    this.bloom.threshold = b.threshold;
    if (this.toneMap) {
      this.renderer.toneMapping = view?.tone === "aces" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      this.renderer.toneMappingExposure = view?.tone === "aces" ? 1.25 : 1;
    }
  }

  gradeActive() {
    const v = this.view;
    return !!(this.toneMap && v && (v.saturation !== 1 || v.posterize > 0 || v.outline > 0 || v.pixel > 0));
  }

  /**
   * Draw one frame. `views` is a list of {scene, camera, x, y, w, h} in
   * drawing-buffer pixels with a bottom-left origin (like gl.viewport); omit
   * x/y/w/h for the full frame. `bloom` overrides `enabled` for this frame.
   */
  render(views, { bloom } = {}) {
    const r = this.renderer;
    const t = this.target;
    r.setRenderTarget(t);
    t.scissorTest = false;
    t.viewport.set(0, 0, this.width, this.height);
    r.clear();
    for (const v of views) {
      const x = v.x ?? 0;
      const y = v.y ?? 0;
      const w = v.w ?? this.width;
      const h = v.h ?? this.height;
      t.viewport.set(x, y, w, h);
      t.scissor.set(x, y, w, h);
      t.scissorTest = true;
      r.setRenderTarget(t); // re-applies the target's viewport and scissor
      r.render(v.scene, v.camera);
    }
    t.scissorTest = false;
    t.viewport.set(0, 0, this.width, this.height);
    r.setRenderTarget(t);
    if (bloom ?? this.enabled) this.bloom.render(r, null, t, 0, false);
    const scissor = r.getScissorTest();
    r.setScissorTest(false);
    let src = t;
    if (this.gradeActive()) {
      const v = this.view;
      const u = this.grade.material.uniforms;
      u.tDiffuse.value = t.texture;
      u.res.value.set(this.width, this.height);
      u.saturation.value = v.saturation;
      u.posterize.value = v.posterize;
      u.outline.value = v.outline;
      u.block.value = v.pixel > 0 ? Math.max(2, Math.round(Math.min(this.width, this.height) * v.pixel * 0.6)) : 0;
      r.setRenderTarget(this.graded);
      this.grade.render(r);
      src = this.graded;
    }
    r.setRenderTarget(null);
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());
    this.output.render(r, null, src);
    r.setScissorTest(scissor);
  }

  dispose() {
    this.target.dispose();
    this.graded.dispose();
    this.grade.material.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
