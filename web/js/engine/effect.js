// Turns a template + seed into a Three.js scene graph and updates it for any
// time t. Everything is a pure function of (template, seed, t), so scrubbing,
// replaying and the four views all show exactly the same cast.

import * as THREE from "three";
import {
  layerIntensity,
  layerWindow,
  paramAtFrom,
  resolveParams,
  rng,
  seedFor,
} from "./timeline.js";
import { PX, buildStage } from "./stage.js";
import { decalPlan, decalState } from "./decal.js";
import { drawDecal } from "./decaltex.js";

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ textures

let softTexture = null;
function soft() {
  if (softTexture) return softTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softTexture = new THREE.CanvasTexture(c);
  softTexture.colorSpace = THREE.SRGBColorSpace;
  return softTexture;
}

// Soft cloudy puffs for smoke and mist: a few seeded fractal-noise blobs,
// shared by every smoke layer.
const cloudTextures = [];
function cloud(k) {
  if (cloudTextures[k]) return cloudTextures[k];
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  const r = rng(seedFor(7, "cloud", k));
  const G = 8;
  const grid = Array.from({ length: (G + 1) * (G + 1) * 3 }, () => r());
  const val = (x, y, o) => {
    const xi = Math.floor(x) % G;
    const yi = Math.floor(y) % G;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => grid[((j % G) * (G + 1) + (i % G)) * 3 + o];
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * G;
      const v = (y / N) * G;
      const n = 0.5 * val(u * 0.5, v * 0.5, 0) + 0.3 * val(u, v, 1) + 0.2 * val(u * 2, v * 2, 2);
      const d = Math.hypot(x - N / 2, y - N / 2) / (N / 2);
      const fall = Math.max(0, 1 - d * d);
      const a = Math.max(0, Math.min(1, fall * (0.35 + 1.1 * n) - 0.25 * d));
      const i = (y * N + x) * 4;
      const lum = 200 + 55 * n;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = lum;
      img.data[i + 3] = Math.round(255 * a * fall);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cloudTextures[k] = tex;
  return tex;
}

// ------------------------------------------------------------ colors

function colorsFor(template, slot) {
  const p = template.palette || {};
  const get = (k) => new THREE.Color(p[k] || p.primary || "#ffffff");
  switch (slot) {
    case "gradient_core_to_primary":
      return [get("core"), get("primary")];
    case "gradient_primary_to_secondary":
      return [get("primary"), get("secondary")];
    case undefined:
      return [get("core"), get("primary")];
    default:
      return [get(slot), get(slot)];
  }
}

// ------------------------------------------------------------ bolt paths

function perpendiculars(dir) {
  const a = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
  const p1 = new THREE.Vector3().crossVectors(dir, a).normalize();
  const p2 = new THREE.Vector3().crossVectors(dir, p1).normalize();
  return [p1, p2];
}

// A jagged 3D path from a to b. Returns segments [{a, b, w}] where w is a
// width multiplier (taper, branch depth).
export function boltSegments(a, b, opts, r) {
  const { segments = 16, jaggedness = 0.6, taper = 0.4, branch_chance = 0, branch_depth = 0,
    branch_length_ratio = 0.35 } = opts;
  const out = [];
  const grow = (from, to, n, depth, width) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-4 || n < 1) return;
    dir.normalize();
    const [p1, p2] = perpendiculars(dir);
    const step = len / n;
    const jagStep = Math.min(step, 0.3); // keep long paths from flailing wildly
    const pts = [from.clone()];
    let o1 = 0;
    let o2 = 0;
    for (let i = 1; i < n; i++) {
      const u = i / n;
      o1 = o1 * 0.5 + r.range(-1, 1) * jaggedness * jagStep * 1.4;
      o2 = o2 * 0.5 + r.range(-1, 1) * jaggedness * jagStep * 1.4;
      const env = Math.sin(Math.PI * u) * 0.6 + 0.4;
      pts.push(new THREE.Vector3().copy(from).addScaledVector(dir, len * u)
        .addScaledVector(p1, o1 * env).addScaledVector(p2, o2 * env));
    }
    pts.push(to.clone());
    for (let i = 0; i < pts.length - 1; i++) {
      const u = i / (pts.length - 1);
      out.push({ a: pts[i], b: pts[i + 1], w: width * (1 - taper * u) });
      if (depth > 0 && i > 0 && i < pts.length - 2 && r() < branch_chance) {
        const bdir = dir.clone()
          .addScaledVector(p1, r.range(-1, 1) * 0.9)
          .addScaledVector(p2, r.range(-1, 1) * 0.9)
          .normalize();
        const blen = len * (1 - u) * branch_length_ratio * r.range(0.6, 1.2);
        const end = pts[i].clone().addScaledVector(bdir, blen);
        grow(pts[i], end, Math.max(2, Math.round(n * branch_length_ratio)), depth - 1, width * 0.5);
      }
    }
  };
  grow(a, b, Math.max(1, Math.round(segments)), Math.round(branch_depth), 1);
  return out;
}

// Round liquid drops: point sprites with a soft body, a darker rim and a
// bright glint, alpha-blended so they read as water rather than light.
let dropTexture = null;
function dropTex() {
  if (dropTexture) return dropTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const body = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  body.addColorStop(0, "rgba(235,245,255,0.75)");
  body.addColorStop(0.65, "rgba(200,225,255,0.85)");
  body.addColorStop(0.85, "rgba(120,160,220,0.9)");
  body.addColorStop(1, "rgba(120,160,220,0)");
  g.fillStyle = body;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  const glint = g.createRadialGradient(24, 22, 0, 24, 22, 9);
  glint.addColorStop(0, "rgba(255,255,255,1)");
  glint.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glint;
  g.fillRect(0, 0, 64, 64);
  dropTexture = new THREE.CanvasTexture(c);
  dropTexture.colorSpace = THREE.SRGBColorSpace;
  return dropTexture;
}

const DROP_VERTEX = /* glsl */ `
attribute float size;
uniform float scale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = isOrthographic ? size * scale * projectionMatrix[1][1] : size * scale * projectionMatrix[1][1] / -mv.z;
}`;

const DROP_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform sampler2D map;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(color * t.rgb, t.a);
  #include <colorspace_fragment>
}`;

class DropletPoints {
  constructor(capacity, color) {
    this.capacity = capacity;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("size", this.size);
    this.material = new THREE.ShaderMaterial({
      vertexShader: DROP_VERTEX,
      fragmentShader: DROP_FRAGMENT,
      uniforms: { color: { value: new THREE.Color(color) }, map: { value: dropTex() }, scale: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer) => {
      // Point sizes are in pixels: scale world size by the viewport height.
      const vp = new THREE.Vector4();
      renderer.getCurrentViewport(vp);
      this.material.uniforms.scale.value = vp.w / 2;
    };
    geo.setDrawRange(0, 0);
  }

  // drops: [{p: Vector3, s: world diameter}]
  set(drops) {
    const n = Math.min(this.capacity, drops.length);
    for (let i = 0; i < n; i++) {
      this.pos.array[i * 3] = drops[i].p.x;
      this.pos.array[i * 3 + 1] = drops[i].p.y;
      this.pos.array[i * 3 + 2] = drops[i].p.z;
      this.size.array[i] = drops[i].s;
    }
    this.pos.needsUpdate = this.size.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
  }
}

// Join segments that share endpoints into polylines. boltSegments and the
// beam reuse the same point objects at joints, so a branch starts a new path.
export function segmentsToPaths(segs) {
  const paths = [];
  const tails = new Map(); // end point -> path
  for (const s of segs) {
    let path = tails.get(s.a);
    if (path) tails.delete(s.a);
    else {
      path = { pts: [s.a], w: [s.w] };
      paths.push(path);
    }
    path.pts.push(s.b);
    path.w.push(s.w);
    tails.set(s.b, path);
  }
  return paths;
}

const RIBBON_VERTEX = /* glsl */ `
attribute vec3 prev;
attribute vec3 next;
attribute float side;
attribute float width;
attribute float along;
varying float vSide;
varying float vAlong;
vec3 safeNorm(vec3 v, vec3 fb) { float l = length(v); return l > 1e-6 ? v / l : fb; }
void main() {
  vec4 c = modelViewMatrix * vec4(position, 1.0);
  vec3 p = (modelViewMatrix * vec4(prev, 1.0)).xyz;
  vec3 n = (modelViewMatrix * vec4(next, 1.0)).xyz;
  vec3 d1 = safeNorm(c.xyz - p, vec3(0.0, 1.0, 0.0));
  vec3 d2 = safeNorm(n - c.xyz, d1);
  vec3 dir = safeNorm(d1 + d2, d1);
  vec3 eye = isOrthographic ? vec3(0.0, 0.0, 1.0) : safeNorm(-c.xyz, vec3(0.0, 0.0, 1.0));
  // Widen the ribbon sideways to the camera: it always shows its flat face.
  vec3 perp = safeNorm(cross(dir, eye), vec3(1.0, 0.0, 0.0));
  vec3 n1 = safeNorm(cross(d1, eye), perp);
  float miter = clamp(1.0 / max(0.35, abs(dot(perp, n1))), 1.0, 2.0);
  gl_Position = projectionMatrix * vec4(c.xyz + perp * side * width * miter, 1.0);
  vSide = side;
  vAlong = along;
}`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float hardness;
varying float vSide;
varying float vAlong;
#ifdef FLUID
uniform float time;      // seconds, layer time
uniform float flow;      // texture scroll speed along the ribbon, units/s
uniform float noiseAmt;  // 0..1, how much noise eats the edges
uniform float noiseScale;
uniform float rim;       // bright edge highlight
uniform float foam;      // white streaks
uniform float seed;
uniform vec3 foamColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
#endif
#ifdef FIRE
uniform float time;      // seconds, layer time
uniform float flow;      // how fast the flame rushes along the ribbon, units/s
uniform float noiseAmt;  // 0..1, how much the noise tears the edges into tongues
uniform float noiseScale;
uniform float lick;      // sideways licking speed
uniform float total;     // ribbon length in world units (to cool the far end)
uniform float seed;
uniform vec3 hot;        // white-yellow core
uniform vec3 mid;        // orange body
uniform vec3 cool;       // red edges
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
#endif
void main() {
  float x = abs(vSide);
#ifdef FIRE
  // A temperature field: two layers of fBm rush along the ribbon and lick
  // sideways, tear the edges into tongues, and map heat to a ramp from the
  // white-yellow core through orange to red. The far end runs cooler.
  float u = clamp(vAlong / max(0.001, total), 0.0, 1.0);
  vec2 q = vec2(vAlong * noiseScale - time * flow, vSide * 1.7 - time * lick);
  float n = fbm(q);
  float n2 = fbm(q * 2.3 + vec2(-time * flow * 0.8, 5.2));
  float edge = max(0.12, 1.0 - noiseAmt * (0.1 + 0.8 * n));
  float xe = x / edge;
  float body = xe >= 1.0 ? 0.0 : pow(1.0 - xe * xe, hardness);
  // Hot pockets come and go; the cone cools with distance from the mouth.
  float heat = body * (0.35 + 1.2 * n2 * n2 + 0.2 * n) * mix(1.25, 0.5, u);
  heat = clamp(heat, 0.0, 1.4);
  vec3 c = mix(cool, mid, smoothstep(0.15, 0.55, heat));
  c = mix(c, hot, smoothstep(0.75, 1.15, heat));
  float a = smoothstep(0.02, 0.25, heat);
  gl_FragColor = vec4(c * (0.45 + 0.45 * heat), a * opacity);
#elif defined(FLUID)
  // Noise scrolls along the ribbon (flow), eats into the edges (a ragged,
  // churning silhouette), streaks foam and adds a bright rim like light
  // catching the surface of a water column.
  vec2 q = vec2(vAlong * noiseScale - time * flow, vSide * 1.3);
  float n = fbm(q);
  float edge = max(0.15, 1.0 - noiseAmt * (0.25 + 0.9 * n));
  float xe = x / edge;
  float a = xe >= 1.0 ? 0.0 : pow(1.0 - xe * xe, hardness);
  float streak = fbm(vec2(vAlong * noiseScale * 2.6 - time * flow * 1.35, vSide * 4.0 + 3.7));
  float f = smoothstep(0.5, 0.78, streak) * foam;
  float r = smoothstep(0.45, 0.85, xe) * (1.0 - smoothstep(0.9, 1.0, xe)) * rim * (0.6 + 0.8 * n);
  vec3 c = mix(color, foamColor, clamp(f + r, 0.0, 1.0));
  gl_FragColor = vec4(c, clamp(a * (1.0 + f * 0.6), 0.0, 1.0) * opacity);
#else
  // Soft across the width: bright in the middle, fading to nothing at the edge.
  float a = pow(max(0.0, 1.0 - x * x), hardness);
  gl_FragColor = vec4(color, a * opacity);
#endif
  #include <colorspace_fragment>
}`;

// Camera-facing ribbons with a soft profile, one draw call for many polylines.
// The ribbon turns to face whichever camera draws it (in the vertex shader),
// so all four views stay correct in "All four" mode.
class RibbonMesh {
  // opts.blending (default additive); opts.fluid: {flow, noise, scale, rim, foam, foamColor, seed}
  // turns on the scrolling-noise water/energy look.
  constructor(capacity, color, opacity = 1, hardness = 1, opts = {}) {
    this.capacity = capacity * 2 + 64; // points
    const n = this.capacity;
    const geo = new THREE.BufferGeometry();
    const attr = (k, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(n * 2 * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
      return a;
    };
    this.pos = attr("position", 3);
    this.prev = attr("prev", 3);
    this.next = attr("next", 3);
    this.side = attr("side", 1);
    this.width = attr("width", 1);
    this.along = attr("along", 1);
    this.index = new THREE.BufferAttribute(new Uint32Array(n * 6), 1);
    this.index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this.index);
    for (let i = 0; i < n; i++) {
      this.side.array[i * 2] = -1;
      this.side.array[i * 2 + 1] = 1;
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERTEX,
      fragmentShader: RIBBON_FRAGMENT,
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: opacity },
        hardness: { value: hardness },
        ...(opts.fluid ? {
          time: { value: 0 },
          flow: { value: opts.fluid.flow ?? 4 },
          noiseAmt: { value: opts.fluid.noise ?? 0.5 },
          noiseScale: { value: opts.fluid.scale ?? 3 },
          rim: { value: opts.fluid.rim ?? 0.5 },
          foam: { value: opts.fluid.foam ?? 0.5 },
          seed: { value: opts.fluid.seed ?? 0 },
          foamColor: { value: new THREE.Color(opts.fluid.foamColor ?? "#ffffff") },
        } : {}),
        ...(opts.fire ? {
          time: { value: 0 },
          flow: { value: opts.fire.flow ?? 5 },
          noiseAmt: { value: opts.fire.noise ?? 0.6 },
          noiseScale: { value: opts.fire.scale ?? 2.5 },
          lick: { value: opts.fire.lick ?? 1.5 },
          total: { value: 1 },
          seed: { value: opts.fire.seed ?? 0 },
          hot: { value: new THREE.Color(opts.fire.hot ?? "#fff6d0") },
          mid: { value: new THREE.Color(opts.fire.mid ?? "#ff8a1e") },
          cool: { value: new THREE.Color(opts.fire.cool ?? "#c42a0c") },
        } : {}),
      },
      defines: opts.fire ? { FIRE: 1 } : opts.fluid ? { FLUID: 1 } : {},
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    geo.setDrawRange(0, 0);
  }

  get opacity() {
    return this.material.uniforms.opacity.value;
  }

  // Layer time in ms, for fluid ribbons (scrolling noise). Pure: the look
  // depends only on this value.
  setTime(ms) {
    if (this.material.uniforms.time) this.material.uniforms.time.value = ms / 1000;
  }

  set opacity(v) {
    this.material.uniforms.opacity.value = v;
  }

  // segs: [{a, b, w}] (joined into polylines), radius: half-width in world units.
  set(segs, radius) {
    this.setPaths(segmentsToPaths(segs), radius);
  }

  // paths: [{pts: [Vector3], w: [width multiplier per point]}].
  setPaths(paths, radius) {
    const P = this.pos.array;
    const V = this.prev.array;
    const N = this.next.array;
    const W = this.width.array;
    const L = this.along.array;
    const I = this.index.array;
    let v = 0; // point index
    let ii = 0;
    const put = (arr, k, p) => {
      arr[k * 6] = arr[k * 6 + 3] = p.x;
      arr[k * 6 + 1] = arr[k * 6 + 4] = p.y;
      arr[k * 6 + 2] = arr[k * 6 + 5] = p.z;
    };
    const tmp = new THREE.Vector3();
    for (const path of paths) {
      const m = path.pts.length;
      if (m < 2 || v + m > this.capacity) continue;
      let dist = path.start ?? 0;
      for (let i = 0; i < m; i++) {
        const k = v + i;
        const p = path.pts[i];
        if (i > 0) dist += p.distanceTo(path.pts[i - 1]);
        L[k * 2] = L[k * 2 + 1] = dist;
        put(P, k, p);
        put(V, k, i > 0 ? path.pts[i - 1] : tmp.copy(p).multiplyScalar(2).sub(path.pts[1]));
        put(N, k, i < m - 1 ? path.pts[i + 1] : tmp.copy(p).multiplyScalar(2).sub(path.pts[m - 2]));
        W[k * 2] = W[k * 2 + 1] = Math.max(0.0005, radius * path.w[i]);
        if (i < m - 1) {
          const a = k * 2;
          I[ii++] = a; I[ii++] = a + 1; I[ii++] = a + 2;
          I[ii++] = a + 1; I[ii++] = a + 3; I[ii++] = a + 2;
        }
      }
      v += m;
    }
    if (this.material.uniforms.total) {
      let longest = 0;
      for (let k = 0; k < v; k++) longest = Math.max(longest, L[k * 2]);
      this.material.uniforms.total.value = Math.max(0.001, longest);
    }
    for (const a of [this.pos, this.prev, this.next, this.width, this.along, this.index]) a.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, ii);
  }
}

// ------------------------------------------------------------ layers

class Layer {
  constructor(effect, def, instance = 0) {
    this.effect = effect;
    this.def = def;
    this.instance = instance;
    this.group = new THREE.Group();
    this.group.name = `${def.id}#${instance}`;
    this.base = resolveParams(def.params, effect.seed, `${def.id}#${instance}`);
    this.window = layerWindow(effect.template, def);
    this.offset = effect.chainOffset(def, instance);
    this.colors = colorsFor(effect.template, def.color);
    this.visible = true;
  }

  p(name, t, fallback) {
    const v = paramAtFrom(this.base, this.def.keyframes, name, t, this.window?.start ?? 0);
    return v === undefined || v === null ? fallback : v;
  }

  rng(...parts) {
    return rng(seedFor(this.effect.seed, this.def.id, this.instance, ...parts));
  }

  anchorPos() {
    return this.effect.stage.anchor(this.def.anchor || "target", this.instance);
  }

  intensityAt(t) {
    return layerIntensity(this.effect.template, this.def, t, this.effect.seed);
  }

  // Local layer time, 0 at window start.
  local(t) {
    return t - (this.window?.start ?? 0);
  }

  update() {}

  points() {
    return [this.anchorPos()];
  }
}

class BoltLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    const [core, outer] = this.colors;
    const secondary = new THREE.Color(effect.template.palette.secondary || effect.template.palette.primary);
    this.core = new RibbonMesh(600, core, 1, 0.5);
    this.outer = new RibbonMesh(600, outer, 0.85, 1.4);
    this.glow = new RibbonMesh(600, secondary, 0.22, 2.5);
    this.group.add(this.glow.mesh, this.outer.mesh, this.core.mesh);
    this.segs = [];
  }

  // The beam this bolt rides on, if it is attached to one.
  beam() {
    const attached = this.def.attach_to && this.effect.layerById(this.def.attach_to, this.instance);
    return attached instanceof BeamLayer ? attached : null;
  }

  endpoints() {
    const st = this.effect.stage;
    const tp = this.effect.template;
    const attached = this.def.attach_to && this.effect.layerById(this.def.attach_to, this.instance);
    if (attached && attached.endpoints) return attached.endpoints();
    switch (this.def.anchor) {
      case "sky":
        return [[st.sky, st.anchor("target")]];
      case "caster_hand":
        if (tp.space.travel === "chain") {
          const hops = [];
          let from = st.hand;
          st.targets.forEach((_, k) => {
            const to = st.chest(k);
            hops.push([from, to]);
            from = to;
          });
          return hops;
        }
        return [[st.hand, st.anchor(tp.space.destination === "point" ? "point" : "target")]];
      default:
        return [[this.anchorPos().setY(1.5), this.anchorPos()]];
    }
  }

  update(t) {
    const w = this.window;
    const after = this.p("afterimage_ms", t, 0);
    let I = this.intensityAt(t);
    if (w && t > w.end && t <= w.end + after) I = 0.35 * (1 - (t - w.end) / after);
    if (I <= 0.001 || !w) {
      this.group.visible = false;
      this.segs = [];
      return;
    }
    this.group.visible = true;
    const regen = this.p("regen_ms", t, 0);
    const tick = regen > 0 ? Math.floor(Math.max(0, t - w.start) / regen) : 0;
    const opts = {
      segments: this.p("segments", t, 16),
      jaggedness: this.p("jaggedness", t, 0.6),
      taper: this.p("taper", t, 0.4),
      branch_chance: this.p("branch_chance", t, 0),
      branch_depth: this.p("branch_depth", t, 0),
      branch_length_ratio: this.p("branch_length_ratio", t, 0.35),
    };
    const beam = this.beam();
    const hops = beam ? [] : this.endpoints();
    const isChain = this.effect.template.space.travel === "chain" && hops.length > 1;
    let segs = beam ? hugArcs(beam.path, beam.halfWidth, opts, this.rng("hug", tick)) : [];
    hops.forEach(([a, b], k) => {
      const appear = isChain ? w.start + this.effect.stage.hopDelay(k) : w.start;
      if (t < appear) return;
      const r = this.rng("path", k, tick);
      let s = boltSegments(a, b, opts, r);
      if (isChain) s.forEach((x) => (x.w *= Math.pow(0.85, k)));
      // Leader: a faint path that grows from the source before the main strike.
      const leader = this.p("leader_ms", t, 0);
      if (leader > 0 && t - appear < leader) {
        const u = (t - appear) / leader;
        s = s.slice(0, Math.ceil(s.length * u));
        s.forEach((x) => (x.w *= 0.35));
      }
      segs = segs.concat(s);
    });
    this.segs = segs;
    const width = this.p("width_px", t, 4) * PX;
    const glowPx = this.p("glow_px", t, 10) * PX;
    this.core.set(segs, width * 0.22);
    this.outer.set(segs, width * 0.6);
    this.glow.set(segs, Math.max(width, glowPx) * 1.2);
    this.core.opacity = Math.min(1, I * 1.1);
    this.outer.opacity = 0.85 * I;
    this.glow.opacity = 0.18 * I;
  }

  points() {
    const pts = [];
    this.segs.forEach((s, i) => {
      if (i % 3 === 0) pts.push(s.a);
    });
    return pts;
  }
}

// Short arcs that ride along a beam: each one jumps between two nearby points
// on the beam's path and never strays further than about two beam widths, so
// they hug the beam instead of flailing across the screen.
export function hugArcs(path, halfWidth, opts, r) {
  if (!path || path.length < 2) return [];
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lengths[lengths.length - 1];
  if (total < 1e-3) return [];
  const at = (d) => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const u = (d - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1]);
    return path[i - 1].clone().lerp(path[i], u);
  };
  const count = Math.max(1, Math.round((opts.segments ?? 12) / 3));
  const reach = Math.max(0.02, halfWidth * 3);
  const out = [];
  for (let k = 0; k < count; k++) {
    const span = r.range(0.25, 0.7) * Math.min(1, total / 2);
    const d0 = r.range(0, Math.max(0, total - span));
    const a = at(d0);
    const b = at(d0 + span);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const [p1, p2] = perpendiculars(dir);
    const n = 6 + Math.round(span * 8);
    const pts = [a];
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const env = Math.sin(Math.PI * u);
      const off = reach * env * (opts.jaggedness ?? 0.6);
      pts.push(at(d0 + span * u)
        .addScaledVector(p1, r.range(-1, 1) * off)
        .addScaledVector(p2, r.range(-1, 1) * off));
    }
    pts.push(b);
    for (let i = 0; i < pts.length - 1; i++) out.push({ a: pts[i], b: pts[i + 1], w: 1 - (opts.taper ?? 0.4) * Math.abs(i / (pts.length - 1) - 0.5) * 2 });
  }
  return out;
}

class CrackleLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.core = new RibbonMesh(300, this.colors[0].clone().lerp(new THREE.Color("#ffffff"), 0.5), 1, 0.5);
    this.outer = new RibbonMesh(300, this.colors[1], 0.6, 1.5);
    this.group.add(this.outer.mesh, this.core.mesh);
  }

  update(t) {
    const I = this.intensityAt(t);
    this.group.visible = I > 0.001;
    if (!this.group.visible) return;
    const regen = this.p("regen_ms", t, 50);
    const tick = Math.floor(Math.max(0, this.local(t)) / Math.max(10, regen));
    const r = this.rng("crackle", tick);
    const count = Math.round(this.p("count", t, 3));
    const len = this.p("length_px", t, 16) * PX * 2.2;
    const radius = this.p("radius_px", t, 30) * PX;
    const center = this.anchorPos();
    const onGround = center.y < 0.05;
    let segs = [];
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = Math.sqrt(r()) * radius;
      const start = center.clone().add(new THREE.Vector3(Math.cos(a) * d, onGround ? 0.01 : r.range(-radius, radius), Math.sin(a) * d));
      const dir = onGround
        ? new THREE.Vector3(r.range(-1, 1), r.range(0.05, 0.5), r.range(-1, 1)).normalize()
        : new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
      // Inflow crackles (large radius around a hand) point at the centre.
      if (!onGround && radius > 0.4) dir.subVectors(center, start).normalize();
      const end = start.clone().addScaledVector(dir, len * r.range(0.6, 1.2));
      segs = segs.concat(boltSegments(start, end, { segments: 5, jaggedness: this.p("jaggedness", t, 0.8), taper: 0.6 }, r));
    }
    this.core.set(segs, 0.008);
    this.outer.set(segs, 0.026);
    this.core.opacity = Math.min(1, I * 1.2);
    this.outer.opacity = 0.6 * I;
  }
}

class GlowLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.sprites = [];
    this.material = new THREE.SpriteMaterial({
      map: soft(), color: this.colors[1], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  update(t) {
    const I = this.intensityAt(t);
    this.group.visible = I > 0.001;
    if (!this.group.visible) return;
    const attached = this.def.attach_to && this.effect.layerById(this.def.attach_to, this.instance);
    const pts = attached ? attached.points() : [this.anchorPos()];
    let radius = this.p("radius_px", t, 30) * PX;
    if (attached instanceof OrbLayer) radius += attached.currentRadius * 1.5;
    const pulse = this.p("pulse_hz", t, 0);
    const k = pulse ? 1 + 0.15 * Math.sin((t / 1000) * pulse * Math.PI * 2) : 1;
    while (this.sprites.length < pts.length) {
      const s = new THREE.Sprite(this.material);
      this.sprites.push(s);
      this.group.add(s);
    }
    this.sprites.forEach((s, i) => {
      s.visible = i < pts.length;
      if (!s.visible) return;
      s.position.copy(pts[i]);
      s.scale.setScalar(radius * 2 * k);
    });
    // Bloom already spreads light along bolts and beams, so a glow strung along
    // one stays faint; a glow on a single point is the main soft light.
    this.material.opacity = Math.min(1, I * (pts.length > 1 ? 0.1 : 0.75));
  }
}

class FlashLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: soft(), color: this.colors[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.group.add(this.sprite);
  }

  update(t) {
    const I = this.intensityAt(t);
    const peak = this.p("peak", t, 1);
    const scope = this.p("scope", t, "local");
    this.sprite.visible = scope !== "screen" && I > 0.001;
    if (scope === "screen") {
      if (I > 0.001) {
        const dark = this.def.blend === "multiply";
        this.effect.screen.push({ color: this.colors[0], opacity: I * peak * (dark ? 1 : 0.35), dark });
      }
      return;
    }
    this.sprite.position.copy(this.anchorPos().setY(Math.max(0.4, this.anchorPos().y)));
    this.sprite.scale.setScalar(this.p("radius_px", t, 60) * PX * 2.6);
    this.sprite.material.opacity = I * peak;
  }
}

// Sparks are drawn as short streaks along their motion (where each spark is
// now back to where it was a moment ago), which reads as speed in a still
// frame; slow sparks shrink to dots.
class SparksLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.max = 200;
    const [core, outer] = this.colors;
    // look "droplet": liquid drops (alpha-blended body with a bright glint)
    // instead of glowing sparks.
    this.droplet = this.base.look === "droplet";
    // look "ember": glowing flecks that flutter and flicker as they drift
    // (pair with negative gravity so they float up on the heat).
    this.ember = this.base.look === "ember";
    if (this.droplet) {
      this.streaks = new RibbonMesh(this.max * 4, outer.clone().lerp(core, 0.25), 1, 1.2, { blending: THREE.NormalBlending });
      this.hot = new RibbonMesh(this.max * 4, core, 1, 0.5);
      this.heads = new DropletPoints(this.max, outer.clone().lerp(core, 0.35));
      this.group.add(this.heads.points);
    } else {
      this.streaks = new RibbonMesh(this.max * 4, outer, 1, 1.2);
      this.hot = new RibbonMesh(this.max * 4, core.clone().lerp(outer, 0.35), 1, 0.6);
    }
    this.group.add(this.streaks.mesh, this.hot.mesh);
  }

  update(t) {
    const w = this.window;
    const local = this.local(t);
    const count = Math.min(this.max, Math.round(this.p("count", 0, 20)));
    const life = this.p("lifetime_ms", 0, 400);
    if (!w || local < 0 || local > (w.end - w.start) + life) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const r = this.rng("burst");
    const origin = this.anchorPos();
    const ground = origin.y < 0.05;
    if (ground) origin.y = 0.12;
    const speed = this.p("speed", 0, 300) * PX;
    const spread = this.p("speed_spread", 0, 0.5);
    const gravity = this.p("gravity", 0, 800) * PX;
    const spreadDeg = this.p("spread_deg", 0, 180);
    const drag = Math.max(0.01, this.p("drag", 0, 0.1) * 6);
    const sz = this.p("size_px", 0, 3) * PX;
    // Sparks are born over emit_ms (default 120 ms: one burst); longer reads as a fountain.
    const span = Math.max(1, Math.min(w.end - w.start, this.p("emit_ms", 0, 120)));
    const streakS = this.p("streak_ms", 0, this.droplet ? 30 : this.ember ? 35 : 60) / 1000;
    const paths = [];
    for (let i = 0; i < count; i++) {
      const born = r.range(0, span);
      const lifeI = life * r.range(0.7, 1.2);
      const theta = r.range(0, Math.PI * 2);
      const cone = THREE.MathUtils.degToRad(spreadDeg / 2);
      const phi = spreadDeg >= 360 ? Math.acos(r.range(-1, 1)) : r.range(0, Math.min(Math.PI, cone));
      const v = speed * (1 + r.range(-spread, spread));
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(theta);
      const age = (local - born) / 1000;
      if (age < 0 || age * 1000 > lifeI) continue;
      const ph = i * 2.399; // not from r: sparks skipped above would shift the sequence
      const at = (a) => {
        const travel = (v * (1 - Math.exp(-drag * a))) / drag;
        const flutter = this.ember ? Math.sin(a * 7 + ph) * 0.18 * a : 0;
        return new THREE.Vector3(
          origin.x + dx * travel + flutter,
          Math.max(0.01, origin.y + dy * travel - 0.5 * gravity * a * a),
          origin.z + dz * travel + (this.ember ? Math.cos(a * 5 + ph) * 0.18 * a : 0),
        );
      };
      let fade = 1 - (age * 1000) / lifeI;
      if (this.ember) fade *= 0.55 + 0.45 * Math.abs(Math.sin(age * 23 + ph * 3));
      const head = at(age);
      const tail = at(Math.max(0, age - streakS));
      if (head.distanceTo(tail) < sz * 0.5) tail.copy(head).addScaledVector(UP, -sz * 0.5);
      const mid = head.clone().lerp(tail, 0.5);
      // Drop size varies per spark (by index, so the burst stays seeded).
      const k = 0.45 + 0.9 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      paths.push({ pts: [head, mid, tail], w: [fade, fade * 0.8, 0.15 * fade], k });
    }
    if (this.droplet) {
      // A round drop at the head with a thin wet trail behind it.
      this.heads.set(paths.map((q) => ({ p: q.pts[0], s: sz * 1.5 * q.k * (0.5 + 0.5 * q.w[0]) })));
      this.streaks.setPaths(paths, sz * 0.45);
      this.hot.setPaths(paths, sz * 0.15);
      this.streaks.opacity = 0.6;
      this.hot.opacity = 0.5;
    } else {
      this.streaks.setPaths(paths, sz * 0.75);
      this.hot.setPaths(paths, sz * 0.3);
      this.streaks.opacity = 0.9;
      this.hot.opacity = 1;
    }
  }
}

const RING_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float inner; // inner edge, as a fraction of the outer radius
uniform float softness;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float mid = (inner + 1.0) * 0.5;
  float half_ = max(1e-4, (1.0 - inner) * 0.5);
  float x = clamp(abs(d - mid) / half_, 0.0, 1.0);
  // softness 0: a crisp band; 1: a soft glow that fades to both edges.
  float a = 1.0 - smoothstep(1.0 - max(0.05, softness), 1.0, x);
  // Shockwaves are brightest on their leading edge.
  a *= mix(0.55, 1.0, smoothstep(inner, 1.0, d));
  gl_FragColor = vec4(color, a * opacity);
  #include <colorspace_fragment>
}`;

const PLANE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

class RingLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: {
        color: { value: this.colors[1].clone() },
        opacity: { value: 0 },
        inner: { value: 0.9 },
        softness: { value: Math.max(0, Math.min(1, this.base.softness ?? 0.5)) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.group.add(this.mesh);
  }

  update(t) {
    const w = this.window;
    const I = this.intensityAt(t);
    this.group.visible = !!w && I > 0.001;
    if (!this.group.visible) return;
    const u = Math.min(1, Math.max(0, this.local(t) / Math.max(1, w.end - w.start)));
    const e = 1 - (1 - u) * (1 - u);
    const r0 = this.p("start_radius_px", t, 10) * PX;
    const r1 = this.p("end_radius_px", t, 80) * PX;
    const radius = r0 + (r1 - r0) * e;
    // A soft ring needs room to fade: draw it a little wider than its thickness.
    const thick = (this.p("thickness_px", t, 5) * PX) * (1 + this.material.uniforms.softness.value);
    const outer = radius + thick / 2;
    const at = this.anchorPos();
    this.mesh.position.set(at.x, 0.02, at.z);
    this.mesh.scale.setScalar(outer);
    this.material.uniforms.inner.value = Math.max(0, (radius - thick / 2) / outer);
    this.material.uniforms.opacity.value = Math.min(1, I * (1 - u * 0.7) * 1.3);
  }
}

// A mark on the ground, drawn flat on the ground plane under everything else
// on it. Its texture (seen from above) is generated from the shape and seed;
// opacity, size and rotation over time come from engine/decal.js, which the
// sprite export uses too.
class DecalLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.plan = decalPlan(effect.template, def, effect.seed, instance);
    this.canvas = drawDecal(this.plan.shape, seedFor(effect.seed, def.id, instance, "texture"), { detail: this.plan.detail });
    const map = new THREE.CanvasTexture(this.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({
      map,
      color: this.colors[0],
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: this.plan.blend === "add" ? THREE.AdditiveBlending : this.plan.blend === "multiply" ? THREE.MultiplyBlending : THREE.NormalBlending,
      premultipliedAlpha: this.plan.blend === "multiply",
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.group.add(this.mesh);
  }

  update(t) {
    const st = decalState(this.plan, t);
    this.group.visible = st.opacity > 0.001;
    if (!this.group.visible) return;
    const at = this.anchorPos();
    const size = this.plan.radius_px * PX * 2.2 * st.scale;
    this.mesh.position.set(at.x, 0.004, at.z);
    this.mesh.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(st.rotation_deg));
    this.mesh.scale.set(size * this.plan.stretch, size, 1);
    this.material.opacity = st.opacity;
  }
}

class SmokeLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.sprites = [];
    for (let i = 0; i < 16; i++) {
      // blend "add": glowing billows of flame instead of lit smoke.
      const blending = def.blend === "add" ? THREE.AdditiveBlending : THREE.NormalBlending;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloud(i % 4), color: this.colors[0], transparent: true, depthWrite: false, blending }));
      this.sprites.push(s);
      this.group.add(s);
    }
  }

  update(t) {
    const w = this.window;
    const life = this.p("lifetime_ms", t, 500);
    const local = this.local(t);
    this.group.visible = !!w && local >= 0 && local <= (w.end - w.start) + life;
    if (!this.group.visible) return;
    const r = this.rng("smoke");
    const count = Math.min(16, Math.round(this.p("count", t, 6)));
    const origin = this.anchorPos();
    const rise = this.p("rise_speed", t, 40) * PX;
    const size = this.p("size_px", t, 24) * PX * 2;
    const opacity = this.p("opacity", t, 0.35);
    this.sprites.forEach((s, i) => {
      const born = r.range(0, Math.max(1, (w.end - w.start) * 0.5));
      const dx = r.range(-0.15, 0.15);
      const dz = r.range(-0.15, 0.15);
      const spin0 = r.range(0, Math.PI * 2);
      const spin = r.range(-1.2, 1.2);
      const age = (local - born) / life;
      s.visible = i < count && age >= 0 && age <= 1;
      if (!s.visible) return;
      s.position.set(origin.x + dx * (1 + age), origin.y + 0.1 + rise * age * (life / 1000) * 3, origin.z + dz * (1 + age));
      s.scale.setScalar(size * (0.6 + age));
      s.material.rotation = spin0 + spin * age;
      s.material.opacity = opacity * Math.sin(Math.PI * age);
    });
  }
}

class OrbLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.coreMat = new THREE.MeshBasicMaterial({ color: this.colors[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shellMat = new THREE.MeshBasicMaterial({ color: this.colors[1], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.coreMat);
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.shellMat);
    this.arcs = new RibbonMesh(200, this.colors[1].clone().lerp(new THREE.Color("#fff"), 0.4), 1, 0.6);
    this.trail = new RibbonMesh(64, this.colors[1], 0.7, 1.6);
    this.trailCore = new RibbonMesh(64, this.colors[0], 0.9, 0.6);
    this.group.add(this.trail.mesh, this.trailCore.mesh, this.shell, this.core, this.arcs.mesh);
    this.currentRadius = 0;
    this.pos = this.anchorPos();
    // Projectile spells: an orb held in the hand flies to the target during
    // its travel beat.
    const tp = effect.template;
    const flies = tp.space?.travel === "projectile" && ["caster_hand", "caster"].includes(def.anchor || "target");
    this.flight = flies ? (this.window?.beats || []).find((b) => b.phase === "travel") || null : null;
  }

  // Where the orb is at time t: in the hand, on its way, or at the target.
  posAt(t) {
    const f = this.flight;
    if (!f) return this.anchorPos();
    const st = this.effect.stage;
    const from = st.hand.clone();
    const to = st.chest(0);
    const u = Math.max(0, Math.min(1, (t - f.start_ms) / Math.max(1, f.end_ms - f.start_ms)));
    const e = this.p("travel_ease", t, "linear") === "ease_in" ? u * u : u;
    const arc = this.p("arc_height_px", t, 0) * PX * 4 * e * (1 - e);
    return from.lerp(to, e).add(new THREE.Vector3(0, arc, 0));
  }

  update(t) {
    const I = this.intensityAt(t);
    this.group.visible = I > 0.001;
    if (!this.group.visible) {
      this.currentRadius = 0;
      return;
    }
    const at = this.posAt(t);
    this.pos = at;
    const pulse = this.p("pulse_hz", t, 4);
    const wob = this.p("wobble", t, 0.1);
    const r = this.p("radius_px", t, 10) * PX * (1 + 0.08 * Math.sin((t / 1000) * pulse * Math.PI * 2));
    const n = this.rng("wobble", Math.floor(t / 33));
    this.currentRadius = r;
    this.core.position.copy(at);
    this.shell.position.copy(at);
    this.core.scale.set(r * 0.6 * (1 + wob * n.range(-0.3, 0.3)), r * 0.6 * (1 + wob * n.range(-0.3, 0.3)), r * 0.6);
    this.shell.scale.set(r * (1 + wob * n.range(-0.5, 0.5)), r * (1 + wob * n.range(-0.5, 0.5)), r * (1 + wob * n.range(-0.5, 0.5)));
    this.coreMat.opacity = Math.min(1, I * 1.2);
    this.shellMat.opacity = 0.45 * I;
    const count = Math.round(this.p("crackle_count", t, 3));
    let segs = [];
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(n.range(-1, 1), n.range(-1, 1), n.range(-1, 1)).normalize();
      const a = at.clone().addScaledVector(dir, r * 0.4);
      const b = at.clone().addScaledVector(dir, r * n.range(1.3, 2.2));
      segs = segs.concat(boltSegments(a, b, { segments: 4, jaggedness: 0.9, taper: 0.5 }, n));
    }
    this.arcs.set(segs, 0.009);
    this.arcs.opacity = I;
    this.updateTrail(t, r, I);
  }

  // A tapering streak behind a flying orb: where the orb was over the last trail_ms.
  updateTrail(t, r, I) {
    const f = this.flight;
    const trailMs = this.p("trail_ms", t, 140);
    if (!f || t <= f.start_ms || trailMs <= 0) {
      this.trail.setPaths([], 0);
      this.trailCore.setPaths([], 0);
      return;
    }
    const steps = 16;
    const pts = [];
    const w = [];
    for (let k = 0; k <= steps; k++) {
      const tk = Math.max(f.start_ms, t - (trailMs * k) / steps);
      pts.push(this.posAt(tk));
      w.push(1 - k / steps);
      if (tk === f.start_ms) break;
    }
    const paths = pts.length > 1 ? [{ pts, w }] : [];
    this.trail.setPaths(paths, r * 0.9);
    this.trailCore.setPaths(paths, r * 0.35);
    this.trail.opacity = 0.7 * I;
    this.trailCore.opacity = 0.9 * I;
  }

  points() {
    return [this.pos.clone()];
  }
}

// A continuous stream from the hand. style "energy" (default): a hot core in
// a soft colored sheath. style "water": a churning liquid column: a noisy,
// alpha-blended body whose edges are eaten by scrolling noise, foam streaks
// and bright rims flowing toward the target, a thin bright core, a soft halo,
// width that swells and pinches (churn) and droplets that peel off it (shed).
// style "fire": a flame cone (breath, flamethrower): a temperature field that
// rushes along a widening ribbon (spread) and tears its edges into licking
// tongues, white-yellow at the core through orange to red, with billowing
// flame puffs riding the stream (puff_count), embers shed off it that float
// up (shed_*), and an optional side-to-side sweep (sweep_px, sweep_ms).
class BeamLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.water = this.base.style === "water";
    this.fire = this.base.style === "fire";
    this.fluid = this.water || this.fire;
    const [core, outer] = this.colors;
    const secondary = new THREE.Color(effect.template.palette.secondary || effect.template.palette.primary);
    const seed = (seedFor(effect.seed, def.id, instance, "noise") % 1000) / 10;
    if (this.water) {
      const flow = this.base.flow_speed ?? 6;
      const fluid = (o) => ({ flow, seed, foamColor: core, ...o });
      this.halo = new RibbonMesh(120, outer, 0.18, 2.5);
      this.outer = new RibbonMesh(120, secondary.clone().lerp(outer, 0.45), 0.85, 0.6, {
        blending: THREE.NormalBlending,
        fluid: fluid({ noise: this.base.turbulence ?? 0.6, scale: 2.2, rim: 0.9, foam: this.base.foam ?? 0.6 }),
      });
      this.core = new RibbonMesh(120, outer.clone().lerp(core, 0.6), 0.9, 0.8, {
        fluid: fluid({ flow: flow * 1.3, noise: 0.7, scale: 3.5, rim: 0, foam: 0.8 }),
      });
      this.drops = new RibbonMesh(160, outer.clone().lerp(core, 0.3), 0.6, 1.2, { blending: THREE.NormalBlending });
      this.dropHeads = new DropletPoints(160, outer.clone().lerp(core, 0.35));
      this.group.add(this.halo.mesh, this.outer.mesh, this.core.mesh, this.drops.mesh, this.dropHeads.points);
    } else if (this.fire) {
      const flow = this.base.flow_speed ?? 5;
      const flame = (o) => ({ flow, seed, hot: core, mid: outer, cool: secondary, ...o });
      this.halo = new RibbonMesh(120, outer, 0.15, 2.5);
      // The body is alpha-blended so its red fringes stay saturated on any
      // background; the core and puffs add light on top.
      this.outer = new RibbonMesh(120, outer, 0.9, 0.7, {
        blending: THREE.NormalBlending,
        fire: flame({ noise: this.base.turbulence ?? 0.65, scale: 1.6, lick: 1.8 }),
      });
      this.core = new RibbonMesh(120, core, 0.9, 1.1, {
        fire: flame({ flow: flow * 1.3, noise: 0.5, scale: 2.6, lick: 2.4, mid: core.clone().lerp(outer, 0.45) }),
      });
      this.hotColor = core;
      this.midColor = outer;
      this.coolColor = secondary;
      this.puffs = [];
      for (let i = 0; i < 64; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: cloud(i % 4), color: outer.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        sp.visible = false;
        this.puffs.push(sp);
      }
      this.drops = new RibbonMesh(160, core.clone().lerp(outer, 0.35), 1, 0.6);
      this.group.add(this.halo.mesh, this.outer.mesh, ...this.puffs, this.core.mesh, this.drops.mesh);
    } else {
      this.core = new RibbonMesh(120, core, 1, 0.45);
      this.outer = new RibbonMesh(120, outer, 0.8, 1.2);
      this.halo = new RibbonMesh(120, outer, 0.2, 3);
      this.group.add(this.halo.mesh, this.outer.mesh, this.core.mesh);
    }
    this.segs = [];
    this.path = [];
    this.halfWidth = 0;
  }

  endpoints() {
    const st = this.effect.stage;
    return [[st.hand, st.anchor("point")]];
  }

  update(t) {
    const I = this.intensityAt(t);
    this.group.visible = I > 0.001;
    if (!this.group.visible) {
      this.segs = [];
      this.path = [];
      return;
    }
    const [[a, b0]] = this.endpoints();
    const b = b0.clone();
    // Sweep: the far end swings across the target, one pass every sweep_ms.
    const sweep = this.p("sweep_px", t, 0) * PX;
    if (sweep) {
      const h = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const across = new THREE.Vector3(-h.z, 0, h.x);
      const ms = Math.max(50, this.p("sweep_ms", t, 600));
      b.addScaledVector(across, -sweep * Math.cos((Math.PI * Math.max(0, this.local(t))) / ms));
    }
    const regen = this.p("regen_ms", t, 50);
    const tick = Math.floor(Math.max(0, this.local(t)) / Math.max(10, regen));
    const r = this.rng("beam", tick);
    const n = this.fluid ? 48 : 24;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const [p1, p2] = perpendiculars(dir);
    const wob = this.p("wobble", t, 0.2);
    const hz = this.p("wobble_hz", t, 8);
    const jag = this.p("jaggedness", t, 0.2);
    const sec = t / 1000;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const env = Math.sin(Math.PI * u) * 0.8 + 0.2;
      const s = Math.sin(u * 9 + sec * hz * Math.PI * 2) * wob * 0.12 * env;
      const s2 = this.fluid ? Math.sin(u * 5.3 - sec * hz * 4.1 + 1.7) * wob * 0.06 * env : 0;
      const j = r.range(-1, 1) * jag * 0.06 * env;
      pts.push(a.clone().addScaledVector(dir, len * u).addScaledVector(p1, s + j).addScaledVector(p2, s2 + r.range(-1, 1) * jag * 0.04 * env));
    }
    // Reach full length over grow_ms (default 60 ms: snaps out). A slower
    // grow reads as a jet travelling to the target.
    const grow = Math.min(1, Math.max(0.05, this.local(t) / Math.max(1, this.p("grow_ms", t, 60))));
    const shown = Math.max(2, Math.round(pts.length * grow));
    const segs = [];
    for (let i = 0; i < shown - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], w: 1 });
    this.segs = segs;
    this.path = pts.slice(0, shown);
    this.fullPath = pts;
    const width = this.p("width_px", t, 14) * PX;
    this.halfWidth = width * 0.5;
    if (this.fire) {
      this.updateFire(t, width, I, n, len, sec, grow);
      return;
    }
    if (!this.water) {
      this.core.set(segs, width * 0.18);
      this.outer.set(segs, width * 0.55);
      this.halo.set(segs, width * 1.5);
      this.core.opacity = Math.min(1, I);
      this.outer.opacity = 0.5 * I;
      this.halo.opacity = 0.12 * I;
      return;
    }
    // Water: the column swells and pinches as surges travel down it, and
    // flares a little where it leaves the hand and where it hits.
    const churn = this.p("churn", t, 0.35);
    const flow = this.p("flow_speed", t, 6);
    const w = this.path.map((_, i) => {
      const u = i / n;
      const d = u * len - sec * flow;
      const surge = 0.55 * Math.sin(d * 3.1) + 0.3 * Math.sin(d * 7.3 + 1.3) + 0.15 * Math.sin(d * 13.7 + 4.1);
      const flare = 1 + 0.35 * Math.exp(-u * 12) + 0.45 * Math.exp(-(1 - u) * 10);
      return Math.max(0.35, (1 + churn * surge) * flare);
    });
    const path = [{ pts: this.path, w }];
    for (const m of [this.halo, this.outer, this.core]) m.setTime(this.local(t));
    // The halo fades in from the hand and out at the target, so its ends are soft.
    const hw = w.map((x, i) => x * Math.min(1, (i / n) * 6, (1 - i / n) * 10 + 0.3));
    this.halo.setPaths([{ pts: this.path, w: hw }], width * 1.4);
    this.outer.setPaths(path, width * 0.62);
    this.core.setPaths(path, width * 0.22);
    this.halo.opacity = 0.12 * I;
    this.outer.opacity = Math.min(1, 0.95 * I);
    this.core.opacity = 0.85 * I;
    this.updateShed(t, width, I);
  }

  // Fire: the cone widens from the mouth to `spread` times its width at the
  // far end, surges travel down it (churn), and it flares where it hits.
  updateFire(t, width, I, n, len, sec, grow) {
    const churn = this.p("churn", t, 0.3);
    const flow = this.p("flow_speed", t, 5);
    const spread = this.p("spread", t, 3);
    const profile = (u) => 0.3 + (spread - 0.3) * Math.pow(u, 0.75);
    const w = this.path.map((_, i) => {
      const u = i / n;
      const d = u * len - sec * flow;
      const surge = 0.5 * Math.sin(d * 2.3) + 0.3 * Math.sin(d * 5.9 + 1.1) + 0.2 * Math.sin(d * 11.3 + 2.9);
      // Bulges where it breaks on the target, then rounds off (no hard end).
      const flare = 1 + 0.35 * Math.exp(-(1 - u) * 8);
      const end = Math.min(1, (1 - u) * 9 + 0.3);
      return Math.max(0.05, profile(u) * (1 + churn * surge) * flare * end);
    });
    const path = [{ pts: this.path, w }];
    for (const m of [this.halo, this.outer, this.core]) m.setTime(this.local(t));
    const hw = w.map((x, i) => x * Math.min(1, (i / n) * 5 + 0.2, (1 - i / n) * 4));
    this.halo.setPaths([{ pts: this.path, w: hw }], width * 1.2);
    this.outer.setPaths(path, width * 0.75);
    // The white-hot jet is strongest at the mouth and burns out along the cone.
    this.core.setPaths([{ pts: this.path, w: w.map((x, i) => x * Math.max(0.05, 1 - 0.8 * (i / n))) }], width * 0.24);
    this.halo.opacity = 0.12 * I;
    this.outer.opacity = Math.min(1, 0.9 * I);
    this.core.opacity = Math.min(1, 0.6 * I);
    this.updatePuffs(t, width, I, len, flow, spread, profile, grow);
    this.updateShed(t, width, I);
  }

  // Billowing flame puffs that ride the stream from the mouth to the target,
  // swelling and cooling from white-yellow to orange to red, then rolling up
  // where the stream breaks on the target. Seeded per puff, a function of t.
  updatePuffs(t, width, I, len, flow, spread, profile, grow) {
    const count = Math.min(this.puffs.length, Math.round(this.p("puff_count", t, 24)));
    const size = this.p("puff_size_px", t, 0) * PX || width * 0.9;
    const local = this.local(t);
    const span = Math.max(1, (this.window?.end ?? 0) - (this.window?.start ?? 0));
    const r = this.rng("puffs");
    const speed = Math.max(0.5, flow * 0.9);
    const travel = (len / speed) * 1000; // ms from mouth to target
    const path = this.fullPath;
    const m = path.length - 1;
    const hot = this.hotColor;
    const tmp = new THREE.Color();
    this.puffs.forEach((sp, i) => {
      const born = ((i + r.range(0, 1)) / Math.max(1, count)) * span * 0.92;
      const offA = r.range(-1, 1);
      const offB = r.range(-1, 1);
      const k = r.range(0.75, 1.35);
      const spin0 = r.range(0, Math.PI * 2);
      const age = local - born;
      const raw = age / travel;
      sp.visible = i < count && age >= 0 && raw <= 1.35 && m >= 1 && raw <= grow + 0.02;
      if (!sp.visible) return;
      const u = Math.min(1, raw);
      const extra = Math.max(0, raw - 1);
      const f = u * m;
      const j = Math.min(m - 1, Math.floor(f));
      const at = path[j].clone().lerp(path[j + 1], f - j);
      const dir = new THREE.Vector3().subVectors(path[j + 1], path[j]).normalize();
      const [p1, p2] = perpendiculars(dir);
      const lateral = width * 0.3 * profile(u) * (1 + extra * 2);
      at.addScaledVector(p1, offA * lateral).addScaledVector(p2, offB * lateral * 0.7);
      at.y += 0.15 * u * u + extra * 0.9;
      sp.position.copy(at);
      sp.scale.setScalar(size * k * (0.5 + profile(u) * 0.55 + extra * 1.5));
      sp.material.rotation = spin0 + age * 0.002;
      if (u < 0.5) tmp.copy(hot).lerp(this.midColor, u * 2);
      else tmp.copy(this.midColor).lerp(this.coolColor, Math.min(1, (u - 0.5) * 2 + extra * 2));
      sp.material.color.copy(tmp);
      const fadeIn = Math.min(1, raw * 6);
      const fadeOut = 1 - Math.min(1, extra / 0.35);
      sp.material.opacity = I * 0.6 * fadeIn * fadeOut * (1 - 0.3 * u);
    });
  }

  // Droplets that break off the column and fall. Each one is born at a seeded
  // time and place along the beam, flies off sideways and drops under gravity;
  // all of it is a function of t, so scrubbing works.
  updateShed(t, width, I) {
    const count = Math.round(this.p("shed_count", t, 0));
    const local = this.local(t);
    const span = Math.max(1, (this.window?.end ?? 0) - (this.window?.start ?? 0));
    const life = this.p("shed_life_ms", t, 420);
    const speed = this.p("shed_speed", t, 160) * PX;
    const size = this.p("shed_size_px", t, 3) * PX;
    // Water drops fall; fire embers are carried up by the heat.
    const g = this.fire ? -2.2 : 9;
    const r = this.rng("shed");
    const paths = [];
    const path = this.path;
    for (let i = 0; i < count; i++) {
      const born = r.range(0, span);
      const u = r.range(0.08, 0.95);
      const side = new THREE.Vector3(r.range(-1, 1), r.range(-0.2, 1), r.range(-1, 1)).normalize();
      const v = speed * r.range(0.5, 1.3);
      const lifeI = life * r.range(0.6, 1.2);
      const sz = size * r.range(0.6, 1.4);
      const age = (local - born) / 1000;
      if (age < 0 || age * 1000 > lifeI || path.length < 2) continue;
      const k = Math.min(path.length - 1, Math.floor(u * (path.length - 1)));
      const from = path[k];
      const along = new THREE.Vector3().subVectors(path[Math.min(path.length - 1, k + 1)], path[Math.max(0, k - 1)]).normalize();
      const at = (s) => from.clone()
        .addScaledVector(side, v * s + width * 0.3)
        .addScaledVector(along, v * 0.8 * s)
        .add(new THREE.Vector3(0, -0.5 * g * s * s, 0));
      const head = at(age);
      if (head.y < 0.01) continue;
      const tail = at(Math.max(0, age - 0.03));
      const fade = 1 - (age * 1000) / lifeI;
      paths.push({ pts: [head, head.clone().lerp(tail, 0.5), tail], w: [fade, 0.9 * fade, 0.3 * fade], sz });
    }
    const s = paths.length ? paths.reduce((m, p) => m + p.sz, 0) / paths.length : size;
    if (this.fire) {
      this.drops.setPaths(paths, s * 0.5);
      this.drops.opacity = I;
      return;
    }
    this.drops.setPaths(paths, s * 0.4);
    this.dropHeads.set(paths.map((q) => ({ p: q.pts[0], s: q.sz * 1.6 * (0.5 + 0.5 * q.w[0]) })));
  }

  points() {
    return this.segs.filter((_, i) => i % 3 === 0).map((s) => s.a);
  }
}

class LightLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.light = new THREE.PointLight(this.colors[1], 0, 6, 1.5);
    this.group.add(this.light);
  }

  update(t) {
    const I = this.intensityAt(t);
    this.light.position.copy(this.anchorPos()).setY(0.8);
    this.light.distance = this.p("radius", t, 6);
    this.light.intensity = I * this.p("energy", t, 2) * 3;
  }
}

class ShakeLayer extends Layer {
  update(t) {
    const I = this.intensityAt(t);
    if (I <= 0.001) return;
    const amp = this.p("amplitude_px", t, 4) * PX * 0.5 * I;
    const hz = this.p("frequency_hz", t, 25);
    const tick = Math.floor((t / 1000) * hz);
    const r = this.rng("shake", tick);
    this.effect.shake.x += r.range(-amp, amp);
    this.effect.shake.y += r.range(-amp, amp);
  }
}

// Draws nothing. Sound cues are scheduled by engine/sound.js and played by
// web/js/audio.js; the viewer captions them from the same schedule.
class SoundLayer extends Layer {}

const TYPES = {
  bolt: BoltLayer,
  crackle: CrackleLayer,
  glow: GlowLayer,
  flash: FlashLayer,
  sparks: SparksLayer,
  ring: RingLayer,
  decal: DecalLayer,
  smoke: SmokeLayer,
  orb: OrbLayer,
  beam: BeamLayer,
  light: LightLayer,
  camera_shake: ShakeLayer,
  sound_cue: SoundLayer,
};

// ------------------------------------------------------------ effect

export class Effect {
  constructor(template, seed) {
    this.template = template;
    this.seed = seed >>> 0;
    this.stage = buildStage(template, this.seed);
    this.group = new THREE.Group();
    this.layers = [];
    this.hidden = new Set();
    this.screen = [];
    this.shake = { x: 0, y: 0 };
    const isChain = template.space.travel === "chain";
    const ordered = [...template.layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    for (const def of ordered) {
      const Ctor = TYPES[def.type] || Layer;
      const perTarget = isChain && def.anchor === "target" ? Math.max(1, this.stage.targets.length) : 1;
      for (let k = 0; k < perTarget; k++) {
        const layer = new Ctor(this, def, k);
        // Ground marks draw first (decals, then rings), in z order, so
        // everything standing on the ground draws over them.
        const ground = def.type === "decal" ? -1000 : def.type === "ring" ? -500 : 0;
        layer.group.renderOrder = ground + (def.z ?? 0);
        this.layers.push(layer);
        this.group.add(layer.group);
      }
    }
  }

  chainOffset(def, instance) {
    if (this.template.space.travel !== "chain" || def.anchor !== "target") return 0;
    return this.stage.hopDelay(instance);
  }

  layerById(id, instance = 0) {
    return this.layers.find((l) => l.def.id === id && l.instance === instance)
      || this.layers.find((l) => l.def.id === id);
  }

  update(t) {
    this.screen = [];
    this.shake = { x: 0, y: 0 };
    // Attached layers read their parent's state, so update parents first.
    const parentsFirst = [...this.layers].sort((a, b) => (a.def.attach_to ? 1 : 0) - (b.def.attach_to ? 1 : 0));
    for (const layer of parentsFirst) {
      if (this.hidden.has(layer.def.id)) {
        layer.group.visible = false;
        if (layer.light) layer.light.intensity = 0;
        continue;
      }
      layer.update(t - layer.offset);
    }
  }

  setHidden(id, hidden) {
    if (hidden) this.hidden.add(id);
    else this.hidden.delete(id);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }
}
