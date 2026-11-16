// The decal material for depth, cel bands and fills (lava, glow, liquid,
// void). Flat decals with no fill keep the plain textured material in
// effect.js; this one is used when the style or the template asks for more.
//
// mode 0 "flat": the mark as drawn, plus its fill.
// mode 1 "depth": parallax occlusion over a carved height map, walls lit by
//   a fixed key light and darkened toward the bottom, fill in the bottom.
// mode 2 "bands": cel look, hard alpha bands and an ink edge, flat fill.
// Every uniform is set from (template, seed, t), so frames stay pure.

import * as THREE from "three";

export const FILL_CODES = { none: 0, lava: 1, glow: 2, liquid: 3, void: 4 };
export const MODE_CODES = { flat: 0, depth: 1, bands: 2 };

const vertexShader = /* glsl */ `
uniform vec3 lightDir;
varying vec2 vUv;
varying vec3 vView;
varying vec3 vLight;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 V = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : cameraPosition - wp.xyz;
  mat3 inv = inverse(mat3(modelMatrix));
  vView = inv * V;
  vLight = inv * lightDir;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform sampler2D maps;
uniform vec3 color;
uniform vec3 fillA;
uniform vec3 fillB;
uniform vec3 ink;
uniform float opacity;
uniform float reveal;
uniform float mode;
uniform float depthAmt;
uniform float fill;
uniform float fillAmt;
uniform float heat;
uniform float time;
uniform float flow;
uniform float addLook;
varying vec2 vUv;
varying vec3 vView;
varying vec3 vLight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float depthAt(vec2 uv) { return texture2D(maps, uv).r; }

void main() {
  vec2 uv = vUv;
  float D = abs(depthAmt);
  if (mode > 0.5 && mode < 1.5 && D > 0.001) {
    // Steep parallax: march into the surface until the ray is below it.
    vec3 v = normalize(vView);
    const float STEPS = 28.0;
    vec2 shift = -v.xy / max(v.z, 0.22) * D * 0.035 * sign(depthAmt);
    vec2 delta = shift / STEPS;
    float layer = 0.0;
    float d = depthAt(uv);
    for (int i = 0; i < 28; i++) {
      if (layer >= d) break;
      uv += delta;
      layer += 1.0 / STEPS;
      d = depthAt(uv);
    }
  }
  vec4 tex = texture2D(map, uv);
  vec4 m = texture2D(maps, uv);
  float depth = m.r;
  float rv = 1.0;
  if (reveal < 1.0) rv = 1.0 - smoothstep(reveal * 1.02 - 0.06, reveal * 1.02, length(vUv - 0.5) * 2.0);

  vec3 rgb = color * tex.rgb;
  float a = tex.a;
  float lam = 1.0;
  if (mode > 0.5 && mode < 1.5) {
    float e = 1.5 / 512.0;
    float dx = depthAt(uv + vec2(e, 0.0)) - depthAt(uv - vec2(e, 0.0));
    float dy = depthAt(uv + vec2(0.0, e)) - depthAt(uv - vec2(0.0, e));
    vec3 n = normalize(vec3(dx * depthAmt * 10.0, dy * depthAmt * 10.0, 1.0));
    lam = clamp(dot(n, normalize(vLight)), 0.0, 1.0);
    float carved = clamp(depth * sign(depthAmt), 0.0, 1.0);
    // Light decals (glowing cracks) are carved into plain dark ground;
    // their light comes back as the fill.
    vec3 albedo = addLook > 0.5 ? vec3(0.06, 0.055, 0.05) : rgb;
    float ao = mix(1.0, 0.22, carved * D);
    rgb = albedo * (0.3 + 0.85 * lam) * ao + vec3(0.12, 0.11, 0.1) * pow(lam, 3.0) * clamp((1.0 - n.z) * 6.0, 0.0, 1.0);
    if (depthAmt < 0.0) rgb += vec3(0.25) * pow(lam, 6.0) * depth; // raised: glints on the tops
    a = max(addLook > 0.5 ? 0.0 : tex.a, smoothstep(0.02, 0.3, depth) * 0.9);
  } else if (mode > 1.5) {
    a = tex.a < 0.15 ? 0.0 : tex.a < 0.55 ? 0.6 : 1.0;
    rgb = addLook > 0.5 ? color * 1.6 : rgb;
    if (a == 0.0 && m.g > 0.05) { rgb = ink; a = 0.92; }
  }

  float fm = smoothstep(0.35, 0.85, m.g) * fillAmt;
  if (fill > 0.5 && fm > 0.001) {
    vec2 p = vUv - 0.5;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float n = fbm(uv * 16.0 + vec2(time * 0.07, -time * 0.05) * flow);
    float n2 = fbm(vec2(r * 9.0 - time * 0.6 * flow, ang * 2.0) + n * 1.5);
    vec3 fc;
    float fa = fm;
    if (fill < 1.5) {
      // Lava: white-hot deep down and in the fast streams, dark crust
      // floating on top, cooling to black rock.
      float hot = clamp(depth * 0.45 + n2 * 0.75 - 0.3, 0.0, 1.0);
      fc = mix(fillB * 0.35, fillB, smoothstep(0.0, 0.45, hot));
      fc = mix(fc, fillA, smoothstep(0.75, 1.0, hot)) * (0.75 + 1.3 * hot * hot);
      float crust = smoothstep(0.52, 0.72, n) * (1.0 - hot * 0.7);
      fc = mix(fc, vec3(0.05, 0.018, 0.008), crust * 0.85);
      fc = mix(vec3(0.045, 0.02, 0.012) * (0.6 + n), fc, heat);
    } else if (fill < 2.5) {
      fc = fillA * (1.4 + 2.6 * n2) * (0.88 + 0.12 * sin(time * 7.0)) * heat;
    } else if (fill < 3.5) {
      // Liquid: glossy, a moving highlight, no glow.
      fc = fillA * (0.55 + 0.35 * lam) + vec3(0.6) * pow(n2, 6.0) * 2.0;
      fa *= 0.95;
    } else {
      fc = mix(vec3(0.008, 0.006, 0.012), fillA * 0.9, smoothstep(0.55, 0.9, n2));
    }
    if (mode > 1.5) {
      fa = step(0.4, fm);
      fc = fill < 2.5 ? mix(fillB, fillA, step(0.6, m.g)) * 2.2 * max(heat, 0.15) : fc;
    }
    rgb = mix(rgb, fc, fa);
    a = max(a, fa);
  }
  gl_FragColor = vec4(rgb, a * opacity * rv);
}`;

/**
 * A ShaderMaterial for a decal. `opts`: {map, maps, color, fillA, fillB,
 * mode, depth, fill, flow, additive (draw with additive blending: flat light
 * decals), addLook (the decal was authored as light)}.
 */
export function makeDecalMaterial(opts) {
  const mapsTex = new THREE.CanvasTexture(opts.maps);
  mapsTex.colorSpace = THREE.NoColorSpace;
  mapsTex.anisotropy = 4;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: opts.map },
      maps: { value: mapsTex },
      color: { value: opts.color.clone() },
      fillA: { value: opts.fillA.clone() },
      fillB: { value: opts.fillB.clone() },
      ink: { value: new THREE.Color("#0c0a10") },
      lightDir: { value: new THREE.Vector3(-3, 6, 4).normalize() },
      opacity: { value: 0 },
      reveal: { value: 1 },
      mode: { value: MODE_CODES[opts.mode] ?? 0 },
      depthAmt: { value: opts.depth ?? 0 },
      fill: { value: FILL_CODES[opts.fill] ?? 0 },
      fillAmt: { value: 0 },
      heat: { value: 1 },
      time: { value: 0 },
      flow: { value: opts.flow ?? 1 },
      addLook: { value: opts.addLook ? 1 : 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}
