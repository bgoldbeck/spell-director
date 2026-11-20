// The `coat` layer: a skin over the afflicted character in a status effect
// (burning flesh, a crust of frost, creeping stone, oozing poison, a cursed
// shadow). Its shape follows the viewer's stand-in figure (a capsule body and
// a round head, 1 unit tall), puffed out a little so it sits on the body, or
// (shape "crystal") a faceted block of ice the character is frozen inside.
//
// Everything here is a pure function of its params and time, so the four
// views and scrubbing stay in step, and every pattern loops seamlessly in a
// status effect's loop (its flow scrolls through noise that repeats).

import * as THREE from "three";
import { COAT_PATTERNS, FIGURE } from "./status.js";

export { COAT_PATTERNS, COAT_SHAPES, FIGURE, coatSettings } from "./status.js";

// The noise lattice wraps every PERIOD cells along y, and a flow moves it
// PERIOD cells per cycle, so a whole number of flow cycles per loop returns
// the coat to exactly where it started.
const PERIOD = 16;

const COAT_VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const COAT_FRAGMENT = /* glsl */ `
uniform vec3 fillColor;
uniform vec3 rimColor;
uniform float opacity;
uniform float rim;
uniform float fill;
uniform float scale;
uniform float flow;
uniform float pulse;
uniform float coverFrom;
uniform float cover;
uniform float edge;
uniform float seed;
uniform int pattern;
uniform float yBase;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vViewW;

const float PERIOD = ${PERIOD.toFixed(1)};

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419) + seed * 0.0137);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Value noise that repeats every per cells along y.
float vnoise(vec3 x, float per) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 c = i + o;
    c.y = mod(c.y, per);
    float w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y) * mix(1.0 - f.z, f.z, o.z);
    n += w * hash(c);
  }
  return n;
}

float fbm(vec3 x) {
  float a = 0.5, s = 0.0, per = PERIOD;
  for (int o = 0; o < 4; o++) {
    s += a * vnoise(x, per);
    x *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / 0.9375;
}

// Distance to the nearest cell edge (0 on an edge): crystal facets, cracks.
float cells(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3) - 1.0, float((k / 3) % 3) - 1.0, float(k / 9) - 1.0);
    vec3 c = i + o;
    vec3 jit = vec3(hash(c), hash(c + 13.1), hash(c + 27.7));
    float d = length(o + jit - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewW);
  float facing = abs(dot(N, V));
  float fres = pow(1.0 - facing, 2.0);
  float y = vLocal.y - yBase;
  vec3 p = vLocal * scale;
  vec3 col = fillColor;
  float a = 0.0;
  // Fake key light from above and in front, for the solid skins.
  float lit = 0.45 + 0.55 * max(dot(N, normalize(vec3(-0.45, 0.85, 0.3))), 0.0);
  if (pattern == 0) {
    // glow: a soft sheen with a gentle drifting shimmer.
    float n = fbm(p * 0.6 - vec3(0.0, flow * PERIOD, 0.0));
    a = fill * (0.35 + 0.65 * n) + rim * fres * 1.6;
    col = mix(fillColor, rimColor, clamp(fres * 1.5, 0.0, 1.0));
  } else if (pattern == 1) {
    // flame: tongues licking up the body, hotter toward the core color.
    vec3 q = vec3(p.x, p.y * 0.55 - flow * PERIOD, p.z);
    float n = fbm(q);
    float tongues = smoothstep(0.42, 0.78, n + 0.25 * (1.0 - clamp(y, 0.0, 1.0)));
    a = fill * tongues * 1.3 + rim * fres * 1.2 * tongues;
    col = mix(fillColor, rimColor, smoothstep(0.55, 0.9, n));
  } else if (pattern == 2) {
    // frost: white crystals crusting over the body, edges catching light.
    float e = cells(p * 1.2);
    float spikes = 1.0 - smoothstep(0.0, 0.12, e);
    float n = fbm(p * 1.5);
    a = fill * (0.45 + 0.55 * n) + spikes * 0.5 + rim * fres;
    col = mix(fillColor, rimColor, clamp(spikes + fres, 0.0, 1.0)) * (0.75 + 0.35 * lit);
  } else if (pattern == 3) {
    // stone: grey rock skin with dark cracks, lit from above.
    float n = fbm(p * 1.3);
    float crack = 1.0 - smoothstep(0.0, 0.06, cells(p * 0.9));
    col = fillColor * (0.65 + 0.5 * n) * lit;
    col = mix(col, fillColor * 0.25, crack * 0.85);
    col += rimColor * fres * rim * 0.25;
    a = 0.75 + 0.25 * fill;
  } else if (pattern == 4) {
    // ooze: glossy drips running down the body.
    vec3 q = vec3(p.x * 1.4, p.y * 0.35 + flow * PERIOD, p.z * 1.4);
    float n = fbm(q);
    float drip = smoothstep(0.45, 0.7, n);
    a = fill * (0.25 + drip) + rim * fres * 1.4;
    col = mix(fillColor, rimColor, drip * 0.6 + fres * 0.6);
  } else if (pattern == 5) {
    // shadow: dark smoky wisps rising off the body, a cold rim.
    vec3 q = vec3(p.x, p.y * 0.6 - flow * PERIOD, p.z);
    float n = fbm(q);
    float wisp = smoothstep(0.35, 0.75, n);
    a = fill * (0.35 + 0.65 * wisp);
    col = mix(fillColor, rimColor, fres * rim);
    a += rim * fres * 0.6;
  } else if (pattern == 6) {
    // static: jittering electric creases (redrawn every tick via seed).
    float n = vnoise(p * 1.6, PERIOD);
    float lines = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
    a = fill * lines * 1.6 + rim * fres * 0.9;
    col = mix(fillColor, rimColor, lines);
  } else {
    // ice: a clear block, pale inside, white facet edges and fresnel.
    float e = cells(p * 0.5);
    float crack = 1.0 - smoothstep(0.0, 0.05, e);
    float glint = pow(max(dot(reflect(-V, N), normalize(vec3(-0.5, 0.8, 0.35))), 0.0), 18.0);
    a = fill * 0.45 + rim * fres * 0.9 + crack * 0.35 + glint * 0.8;
    col = mix(fillColor, rimColor, clamp(fres * 1.3 + crack + glint, 0.0, 1.0));
  }
  // Coverage: only between coverFrom and cover above the feet, with a
  // ragged edge (and a bright front with edge_glow, e.g. creeping stone).
  float rag = (fbm(vec3(vLocal.x * 9.0, 0.0, vLocal.z * 9.0)) - 0.5) * 0.08;
  float top = smoothstep(cover + 0.015, cover - 0.015, y + rag);
  float bottom = smoothstep(coverFrom - 0.015, coverFrom + 0.015, y - rag);
  float band = 1.0 - smoothstep(0.0, 0.05, abs(y + rag - cover));
  a *= top * bottom;
  col += rimColor * band * edge * 1.5;
  a += band * edge * top * 0.6;
  a = clamp(a * opacity * (1.0 + pulse), 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export function makeCoatMaterial(fill, rimColor, settings, blendAdd) {
  return new THREE.ShaderMaterial({
    vertexShader: COAT_VERTEX,
    fragmentShader: COAT_FRAGMENT,
    uniforms: {
      fillColor: { value: new THREE.Color(fill) },
      rimColor: { value: new THREE.Color(rimColor) },
      opacity: { value: 0 },
      rim: { value: settings.rim },
      fill: { value: settings.fill },
      scale: { value: settings.scale },
      flow: { value: 0 },
      pulse: { value: 0 },
      coverFrom: { value: settings.coverFrom },
      cover: { value: settings.cover },
      edge: { value: settings.edge },
      seed: { value: 0 },
      pattern: { value: COAT_PATTERNS[settings.pattern].id },
      yBase: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: settings.shape === "crystal" ? THREE.DoubleSide : THREE.FrontSide,
    blending: blendAdd ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// The coat's geometry in the figure's own space (feet at y = 0).
export function coatGeometry(shape, inflate, rand) {
  if (shape === "crystal") {
    // A faceted block of ice: a seven-sided prism, jagged and leaning a
    // little, wide enough to hold the whole figure.
    const geo = new THREE.CylinderGeometry(0.3, 0.33, 1.18, 7, 3, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = 1 + (rand() - 0.5) * 0.28;
      pos.setX(i, pos.getX(i) * k + (rand() - 0.5) * 0.03);
      pos.setZ(i, pos.getZ(i) * k + (rand() - 0.5) * 0.03);
      pos.setY(i, y + (Math.abs(y) > 0.5 ? (rand() - 0.3) * 0.14 : (rand() - 0.5) * 0.05));
    }
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    flat.translate(0, 0.56, 0);
    return flat;
  }
  const F = FIGURE;
  const body = new THREE.CapsuleGeometry(F.bodyR + inflate, F.bodyLen, 6, 16);
  body.translate(0, F.bodyY, 0);
  const head = new THREE.SphereGeometry(F.headR + inflate, 20, 14);
  head.translate(0, F.headY, 0);
  return [body, head];
}
