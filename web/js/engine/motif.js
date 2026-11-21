// Motif meshes and materials: leaves, petals, feathers, water drops and
// faceted gems (see motifplace.js for where they go).

import * as THREE from "three";
import { GEM_CUTS } from "./motifplace.js";

const TAU = Math.PI * 2;

// ------------------------------------------------------------ geometry

// A thin curved blade built along +Y from its base (0) to its tip (1):
// width(v) gives the half width at v. Cupped across (cup) and arched along
// (arch). uv.x runs across (0-1), uv.y along.
function bladeGeometry(width, cup = 0.12, arch = 0.08, rows = 16, cols = 8) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const w = width(v);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = (u * 2 - 1) * w;
      const z = cup * (x * x) / Math.max(0.05, w) - arch * Math.sin(Math.PI * v);
      pos.push(x, v, z);
      uv.push(u, v);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const BLADES = {
  leaf: () => bladeGeometry((v) => 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.02)), 0.85) * (1 - 0.25 * v), 0.14, 0.1),
  petal: () => bladeGeometry((v) => 0.34 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.8)))) * (0.35 + 0.65 * Math.sqrt(v)), 0.2, 0.12),
  feather: () => bladeGeometry((v) => 0.13 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + v * 0.95)), 0.45) * (v < 0.12 ? v / 0.12 * 0.4 + 0.1 : 1), 0.05, 0.12, 20, 8),
};

// A teardrop of water: round below, drawn to a point on top. Centred on its
// middle, two units tall.
function dropletGeometry() {
  const pts = [];
  const N = 24;
  for (let k = 0; k <= N; k++) {
    const a = (Math.PI * k) / N; // 0 = the point on top, PI = the bottom
    const r = Math.sin(a) * Math.pow(Math.sin(a / 2), 1.3) * 0.95;
    pts.push(new THREE.Vector2(Math.max(1e-4, r), Math.cos(a) * 1.05 - 0.15));
  }
  return new THREE.LatheGeometry(pts, 24);
}

// A faceted solid from a stack of rings: each ring {y, s} is the outline
// (unit ring points) scaled by s at height y. A ring with s 0 is a point.
// Non-indexed, so every facet is flat.
function stackGeometry(outline, rings) {
  const pos = [];
  const n = outline.length;
  const at = (ring, k) => [outline[k % n][0] * ring.s, ring.y, outline[k % n][1] * ring.s];
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let k = 0; k < n; k++) {
      const a0 = at(A, k);
      const a1 = at(A, k + 1);
      const b0 = at(B, k);
      const b1 = at(B, k + 1);
      if (A.s > 0) pos.push(...a0, ...b0, ...a1);
      if (B.s > 0) pos.push(...a1, ...b0, ...b1);
    }
  }
  // Flat table on top if the top ring isn't a point.
  const top = rings[rings.length - 1];
  if (top.s > 0) {
    for (let k = 0; k < n; k++) pos.push(0, top.y, 0, ...at(top, k), ...at(top, k + 1));
  }
  const bottom = rings[0];
  if (bottom.s > 0) {
    for (let k = 0; k < n; k++) pos.push(0, bottom.y, 0, ...at(bottom, k + 1), ...at(bottom, k));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function circle(n, rx = 1, rz = 1, rot = 0) {
  return Array.from({ length: n }, (_, k) => {
    const a = (TAU * k) / n + rot;
    return [Math.cos(a) * rx, Math.sin(a) * rz];
  });
}

// A pointed ellipse (marquise) outline.
function lens(n) {
  return Array.from({ length: n }, (_, k) => {
    const a = (TAU * k) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [c * 1.25, Math.sign(s) * Math.pow(Math.abs(s), 1.6) * 0.62];
  });
}

// A heart outline seen from above.
function heartOutline(n) {
  return Array.from({ length: n }, (_, k) => {
    const a = (TAU * k) / n;
    const x = 16 * Math.pow(Math.sin(a), 3);
    const z = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
    return [z / 16, x / 16];
  });
}

// A rectangle with its corners cut (the step cut's outline).
function chamfered(w, d, c) {
  return [
    [w, d - c], [w - c, d], [-w + c, d], [-w, d - c],
    [-w, -d + c], [-w + c, -d], [w - c, -d], [w, -d + c],
  ].map(([x, z]) => [x, -z]).reverse();
}

function gemGeometry(cut) {
  switch (cut) {
    case "emerald":
      return stackGeometry(chamfered(1, 0.72, 0.22), [
        { y: -0.62, s: 0.3 }, { y: -0.36, s: 0.62 }, { y: -0.12, s: 0.88 }, { y: 0, s: 1 }, { y: 0.06, s: 1 },
        { y: 0.2, s: 0.86 }, { y: 0.32, s: 0.68 },
      ]);
    case "cabochon": {
      const g = new THREE.SphereGeometry(1, 32, 20, 0, TAU, 0, Math.PI);
      g.scale(1.15, 0.62, 0.85);
      return g;
    }
    case "marquise":
      return stackGeometry(lens(16), [
        { y: -0.78, s: 0 }, { y: -0.3, s: 0.62 }, { y: 0, s: 1 }, { y: 0.06, s: 1 }, { y: 0.24, s: 0.78 }, { y: 0.34, s: 0.52 },
      ]);
    case "prism": {
      const hex = circle(6);
      return stackGeometry(hex, [
        { y: -1.0, s: 0 }, { y: -0.62, s: 0.5 }, { y: -0.5, s: 0.55 }, { y: 0.45, s: 0.55 }, { y: 0.62, s: 0.46 }, { y: 1.05, s: 0 },
      ]);
    }
    case "heart":
      return stackGeometry(heartOutline(20), [
        { y: -0.7, s: 0 }, { y: -0.28, s: 0.66 }, { y: 0, s: 1 }, { y: 0.06, s: 1 }, { y: 0.22, s: 0.8 }, { y: 0.32, s: 0.56 },
      ]);
    default: {
      // Round brilliant: 8-fold table, star and kite facets on the crown,
      // a deep pavilion to a point (the culet).
      const o = circle(16);
      return stackGeometry(o, [
        { y: -0.86, s: 0 }, { y: -0.42, s: 0.56 }, { y: 0, s: 1 }, { y: 0.05, s: 1 }, { y: 0.22, s: 0.8 }, { y: 0.34, s: 0.56 },
      ]);
    }
  }
}

const geoCache = new Map();
export function motifGeometry(shape, cut) {
  const key = shape === "gem" ? `gem:${cut}` : shape;
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  if (shape === "gem") g = gemGeometry(GEM_CUTS.includes(cut) ? cut : "brilliant");
  else if (shape === "droplet") g = dropletGeometry();
  else g = (BLADES[shape] || BLADES.leaf)();
  geoCache.set(key, g);
  return g;
}

// ------------------------------------------------------------ materials

// Faceted gems and water drops: reflect a soft studio sky (a bright
// overhead softbox and a rim strip) off flat facets, fill the body with
// light bouncing inside it (each facet a different brightness), add rainbow
// fire from dispersion and a bright rim. Lit by itself, so a gem reads the
// same in every view and style.
const JEWEL_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const JEWEL_FRAGMENT = /* glsl */ `
uniform vec3 body;
uniform vec3 core;
uniform float opacity;
uniform float facets;
uniform float clarity;
uniform float fire;
uniform float seed;
uniform float time;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + seed) * 43758.5453); }
vec3 env(vec3 d) {
  // A dark room with two bright softboxes and a faint tinted horizon: the
  // dark areas matter as much as the bright ones, they give facets contrast.
  float sky = smoothstep(-0.2, 1.0, d.y);
  vec3 c = mix(body * 0.06, body * 0.35 + vec3(0.08), sky);
  c += vec3(1.0) * pow(max(dot(d, normalize(vec3(0.35, 0.85, 0.4))), 0.0), 90.0) * 2.4;
  c += vec3(1.0) * pow(max(dot(d, normalize(vec3(-0.7, 0.25, -0.65))), 0.0), 60.0) * 1.2;
  c += core * smoothstep(0.03, 0.0, abs(d.y - 0.05)) * 0.35;
  return c;
}
vec3 rainbow(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = facets > 0.5 ? normalize(cross(dFdx(vWorld), dFdy(vWorld))) : normalize(vNormalW);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 R = reflect(-V, N);
  vec3 refl = env(R);
  // Light bouncing inside: each facet catches a different amount.
  float f = facets > 0.5 ? hash(floor(N * 7.0)) : 0.5 + 0.5 * sin(dot(vLocal, vec3(3.1, 4.7, 2.3)) + time);
  vec3 inside = body * (0.12 + 0.95 * f * f * clarity + (1.0 - clarity) * 0.6 * (0.45 + 0.55 * ndv));
  inside += core * pow(f, 8.0) * 1.3 * clarity;
  // Fire: rainbow flashes that shift as the gem turns.
  inside += rainbow(f * 2.3 + dot(N, V) * 1.7 + 0.1 * sin(time)) * fire * pow(f, 3.0) * 1.2;
  // Jade and other milky stones glow softly through (subsurface-ish).
  vec3 col = mix(inside, refl, mix(0.2, 0.7, fres) * mix(0.6, 1.0, clarity));
  col += core * fres * 0.25;
  gl_FragColor = vec4(col, opacity * mix(0.94, 0.82 + 0.18 * fres, clarity));
  #include <colorspace_fragment>
}`;

// Water drops: mostly clear, a bright rim, a sky reflection on top and a
// caustic spot on the far side.
const DROPLET_FRAGMENT = /* glsl */ `
uniform vec3 body;
uniform vec3 core;
uniform float opacity;
uniform float time;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, normalize(vec3(0.3, 0.9, 0.35))), 0.0), 60.0) * 2.5;
  float sky = smoothstep(0.0, 0.8, R.y);
  float caustic = smoothstep(0.55, 1.0, -vLocal.y) * pow(ndv, 2.0);
  vec3 col = body * (0.25 + 0.6 * fres) + vec3(0.9, 0.97, 1.0) * sky * fres * 0.8 + core * caustic * 0.9 + vec3(spec);
  gl_FragColor = vec4(col, opacity * clamp(0.18 + 0.75 * fres + spec + caustic * 0.4, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// Leaves, petals and feathers: a gradient from base to tip, veins (or a
// feather's barbs), soft light from above on both faces, light glowing
// through at the edges, and soft edges.
const BLADE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BLADE_FRAGMENT = /* glsl */ `
uniform vec3 baseColor;
uniform vec3 tipColor;
uniform vec3 edgeColor;
uniform float opacity;
uniform float kind; // 0 leaf, 1 petal, 2 feather
uniform float glow;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0; // 0 at the midrib, 1 at the edge
  float v = vUv.y;
  vec3 col = mix(baseColor, tipColor, smoothstep(0.05, 0.95, v));
  float vein = 0.0;
  if (kind < 0.5) {
    vein = smoothstep(0.06, 0.0, x) * (1.0 - v * 0.6);
    float side = fract((v - x * 0.45) * 7.0);
    vein += smoothstep(0.08, 0.0, abs(side - 0.5) - 0.42) * (1.0 - x) * 0.5;
  } else if (kind < 1.5) {
    vein = smoothstep(0.5, 0.0, x) * 0.15 + smoothstep(0.03, 0.0, abs(fract(x * 4.0 + v * 0.5) - 0.5) - 0.45) * 0.12;
    col = mix(col, edgeColor, smoothstep(0.6, 1.0, v) * 0.25);
  } else {
    float shaft = smoothstep(0.08, 0.0, x);
    float barbs = smoothstep(0.35, 0.0, abs(fract((v - x * 0.55) * 38.0) - 0.5) - 0.1);
    col *= 0.82 + 0.18 * barbs;
    vein = shaft * 0.9;
  }
  col = mix(col, edgeColor, vein * 0.55);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (dot(N, V) < 0.0) N = -N;
  float light = 0.55 + 0.45 * abs(dot(N, normalize(vec3(0.3, 0.9, 0.3))));
  float spec = pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 0.9, 0.3))), 0.0), 24.0) * 0.35;
  col = col * light + vec3(spec);
  // Light through the thin edge.
  col += edgeColor * smoothstep(0.55, 1.0, x) * glow;
  float edge = kind > 1.5 ? smoothstep(1.0, 0.7, x) * (0.75 + 0.25 * smoothstep(0.25, 0.0, abs(fract((v - x * 0.55) * 19.0) - 0.5))) : smoothstep(1.0, 0.82, x);
  float tipFade = smoothstep(1.0, 0.97, v);
  gl_FragColor = vec4(col, opacity * edge * tipFade);
  #include <colorspace_fragment>
}`;

export function jewelMaterial(body, core, look) {
  return new THREE.ShaderMaterial({
    vertexShader: JEWEL_VERTEX,
    fragmentShader: JEWEL_FRAGMENT,
    uniforms: {
      body: { value: body.clone() },
      core: { value: core.clone() },
      opacity: { value: 0 },
      facets: { value: look.facets ? 1 : 0 },
      clarity: { value: look.clarity },
      fire: { value: look.fire },
      seed: { value: 0 },
      time: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

export function dropletMaterial(body, core) {
  return new THREE.ShaderMaterial({
    vertexShader: JEWEL_VERTEX,
    fragmentShader: DROPLET_FRAGMENT,
    uniforms: { body: { value: body.clone() }, core: { value: core.clone() }, opacity: { value: 0 }, time: { value: 0 } },
    transparent: true,
    depthWrite: false,
  });
}

export function bladeMaterial(kind, base, tip, edge) {
  return new THREE.ShaderMaterial({
    vertexShader: BLADE_VERTEX,
    fragmentShader: BLADE_FRAGMENT,
    uniforms: {
      baseColor: { value: base.clone() },
      tipColor: { value: tip.clone() },
      edgeColor: { value: edge.clone() },
      opacity: { value: 0 },
      kind: { value: { leaf: 0, petal: 1, feather: 2 }[kind] ?? 0 },
      glow: { value: 0.35 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

// A four-pointed star glint, shared by every sparkling motif.
let starTexture = null;
export function starTex() {
  if (starTexture) return starTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 18);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = "lighter";
  for (const [w, h] of [[60, 2.2], [2.2, 60], [26, 1.4], [1.4, 26]]) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, Math.max(w, h));
    r.addColorStop(0, "rgba(255,255,255,0.95)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.save();
    g.translate(64, 64);
    if (w === 26 || h === 26) g.rotate(Math.PI / 4);
    g.fillRect(-w, -h, w * 2, h * 2);
    g.restore();
  }
  starTexture = new THREE.CanvasTexture(c);
  starTexture.colorSpace = THREE.SRGBColorSpace;
  return starTexture;
}

// ------------------------------------------------------------ banner

// A war banner: a pole (1 unit tall, base at 0) with a crossbar near the
// top and a cloth hanging from it that ripples in the wind, a trim along
// its edges, a swallowtail and an emblem in the middle. The cloth hangs in
// the pole's YZ plane, so it faces along the item's +X (its face).
const BANNER_W = 0.21; // half width of the cloth
const BANNER_TOP = 0.93;
const BANNER_DROP = 0.56;

function clothGeometry() {
  const g = new THREE.PlaneGeometry(BANNER_W * 2, BANNER_DROP, 14, 18);
  g.rotateY(Math.PI / 2); // into the YZ plane, facing +X
  g.translate(0.03, BANNER_TOP - BANNER_DROP / 2, 0);
  return g;
}

const CLOTH_VERTEX = /* glsl */ `
uniform float phase;
uniform float wave;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec3 p = position;
  // Ripples run down and across the cloth, growing toward its free end.
  float hang = clamp((${BANNER_TOP.toFixed(3)} - p.y) / ${BANNER_DROP.toFixed(3)}, 0.0, 1.0);
  float w = sin(phase - p.z * 11.0 - hang * 5.0) * 0.6 + sin(phase * 2.0 + 1.3 - p.z * 17.0 - hang * 9.0) * 0.25;
  p.x += wave * 0.07 * (0.25 + hang) * w;
  p.z += wave * 0.02 * hang * sin(phase + hang * 4.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CLOTH_FRAGMENT = /* glsl */ `
uniform vec3 cloth;
uniform vec3 trim;
uniform float opacity;
uniform float emblem; // 0 none, 1 chevron, 2 sun, 3 star, 4 fang, 5 crown
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec2 uv = vUv; // x across (0-1), y up (0 bottom, 1 top)
  // Swallowtail: a V cut out of the bottom edge.
  float cut = 0.16 * (1.0 - abs(uv.x - 0.5) * 2.0);
  if (uv.y < cut) discard;
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float light = 0.45 + 0.55 * abs(dot(N, normalize(vec3(-0.4, 0.8, 0.45))));
  // Folds catch the light: a soft sheen across the ripples.
  float sheen = pow(max(dot(reflect(-V, N), normalize(vec3(-0.4, 0.8, 0.45))), 0.0), 10.0) * 0.35;
  vec3 col = cloth * mix(0.55, 1.0, uv.y) * light + vec3(sheen);
  // Trim along the sides, the top and the cut.
  float edge = min(min(uv.x, 1.0 - uv.x), min(1.0 - uv.y, (uv.y - cut) * 0.9));
  float trimBand = smoothstep(0.05, 0.035, edge);
  col = mix(col, trim * (0.7 + 0.5 * light), trimBand);
  // The emblem, centred a little above the middle.
  vec2 p = vec2((uv.x - 0.5) * ${(BANNER_W * 2 / BANNER_DROP).toFixed(3)}, uv.y - 0.56);
  float e = 0.0;
  if (emblem > 0.5 && emblem < 1.5) {
    // Two stacked chevrons pointing up.
    float c1 = abs(p.y - 0.02 + abs(p.x) * 0.9) - 0.035;
    float c2 = abs(p.y + 0.12 + abs(p.x) * 0.9) - 0.035;
    e = (1.0 - smoothstep(0.0, 0.012, min(c1, c2))) * step(abs(p.x), 0.26);
  } else if (emblem > 1.5 && emblem < 2.5) {
    // A sun: a disc with rays.
    float r = length(p);
    float a = atan(p.y, p.x);
    float rays = step(0.6, cos(a * 12.0)) * smoothstep(0.24, 0.2, r) * step(0.13, r);
    e = max(1.0 - smoothstep(0.1, 0.115, r), rays);
  } else if (emblem > 2.5 && emblem < 3.5) {
    // A five-pointed star.
    float a = atan(p.x, p.y);
    float r = mix(0.075, 0.19, pow(0.5 + 0.5 * cos(5.0 * a), 3.0));
    e = 1.0 - smoothstep(r - 0.012, r, length(p));
  } else if (emblem > 3.5 && emblem < 4.5) {
    // A fang: a curved tooth pointing down.
    float y = p.y + 0.02;
    float w = 0.085 * clamp((y + 0.2) / 0.34, 0.0, 1.0);
    float bend = 0.6 * (y - 0.14) * (y - 0.14);
    e = (1.0 - smoothstep(w - 0.01, w, abs(p.x + bend))) * step(-0.2, y) * step(y, 0.14);
  } else if (emblem > 4.5) {
    // A crown: a band with three points.
    float band = step(abs(p.y + 0.08), 0.04) * step(abs(p.x), 0.17);
    float d = abs(fract((p.x + 0.17) / 0.17 + 0.5) - 0.5) * 0.17;
    float pts = step(abs(p.x), 0.17) * step(-0.04, p.y) * step(p.y, 0.14 - 1.6 * d);
    e = max(band, pts);
  }
  col = mix(col, trim * 1.25, e);
  gl_FragColor = vec4(col, opacity);
  #include <colorspace_fragment>
}`;

export const BANNER_EMBLEMS = ["none", "chevron", "sun", "star", "fang", "crown"];

/** {parts: [Mesh], mats, cloth}: a banner in `color` with `trim` metal. */
export function bannerParts(color, trim, emblem = "chevron") {
  const cloth = new THREE.ShaderMaterial({
    vertexShader: CLOTH_VERTEX,
    fragmentShader: CLOTH_FRAGMENT,
    uniforms: {
      cloth: { value: color.clone() },
      trim: { value: trim.clone() },
      opacity: { value: 0 },
      phase: { value: 0 },
      wave: { value: 0.5 },
      emblem: { value: Math.max(0, BANNER_EMBLEMS.indexOf(emblem)) },
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
  const wood = new THREE.MeshStandardMaterial({ color: "#3b2f26", roughness: 0.7, metalness: 0.1, transparent: true });
  const metal = new THREE.MeshStandardMaterial({ color: trim.clone(), roughness: 0.35, metalness: 0.5, emissive: trim.clone().multiplyScalar(0.5), transparent: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 1.0, 8), wood);
  pole.position.y = 0.5;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, BANNER_W * 2 + 0.06, 6), metal);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.03, BANNER_TOP + 0.01, 0);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 8), metal);
  finial.position.y = 1.04;
  const flag = new THREE.Mesh(clothGeometry(), cloth);
  flag.frustumCulled = false;
  return { parts: [pole, bar, finial, flag], mats: [cloth, wood, metal], cloth };
}
