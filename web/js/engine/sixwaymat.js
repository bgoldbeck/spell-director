// The viewer's six-way lit smoke material: a camera-facing puff that reads
// the two baked six-way maps (engine/sixway.js) and relights them from every
// light in the scene (the stage's hemisphere and key light plus the spell's
// own point lights). Three.js passes the lights in view space, where a
// billboard's frame is simply x = right, y = up, z = toward the camera, so the
// six maps blend straight from each light's direction.

import * as THREE from "three";
import { SIXWAY_FRAMES, SIXWAY_VIEW_PX, bakeSixWay } from "./sixway.js";

let maps = null;
export function sixwayMaps() {
  if (maps) return maps;
  const bake = bakeSixWay({ size: SIXWAY_VIEW_PX, frames: SIXWAY_FRAMES });
  const tex = (data) => {
    const t = new THREE.DataTexture(data, bake.width, bake.height, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace; // linear light values
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  maps = { bake, pos: tex(bake.pos), neg: tex(bake.neg) };
  return maps;
}

const VERTEX = /* glsl */ `
uniform float rot;
varying vec2 vUv;
varying vec3 vViewPos;
varying float vWorldY;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  vec2 p = position.xy * s;
  float c = cos(rot);
  float n = sin(rot);
  mv.xy += vec2(c * p.x - n * p.y, n * p.x + c * p.y);
  vViewPos = mv.xyz;
  vWorldY = (inverse(viewMatrix) * mv).y;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <lights_pars_begin>
uniform sampler2D posMap;
uniform sampler2D negMap;
uniform vec3 albedo;
uniform float opacity;
uniform float frame;
uniform vec2 grid;
uniform float frames;
uniform float rot;
uniform float gain;
varying vec2 vUv;
varying vec3 vViewPos;
varying float vWorldY;

vec2 cellUv(float f) {
  float col = mod(f, grid.x);
  float row = floor(f / grid.x);
  // Atlas rows are top-down image rows, uploaded bottom-up.
  return vec2((col + vUv.x) / grid.x, (row + 1.0 - vUv.y) / grid.y);
}

vec4 P;
vec4 N;

// Light from view-space direction l, turned into the puff's (rotated) frame.
float sixway(vec3 l) {
  float c = cos(rot);
  float n = sin(rot);
  vec3 d = vec3(c * l.x + n * l.y, -n * l.x + c * l.y, l.z);
  vec3 w = d * d;
  return w.x * (d.x > 0.0 ? P.r : N.r) + w.y * (d.y > 0.0 ? P.g : N.g) + w.z * (d.z > 0.0 ? N.b : P.b);
}

void main() {
  float f0 = floor(frame);
  float f1 = min(f0 + 1.0, frames - 1.0);
  float k = frame - f0;
  P = mix(texture2D(posMap, cellUv(f0)), texture2D(posMap, cellUv(f1)), k);
  N = mix(texture2D(negMap, cellUv(f0)), texture2D(negMap, cellUv(f1)), k);
  float alpha = P.a * opacity * smoothstep(0.0, 0.18, vWorldY);
  if (alpha < 0.003) discard;

  vec3 light = ambientLightColor * (P.r + N.r + P.g + N.g + P.b + N.b) / 6.0;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
    vec3 up = hemisphereLights[i].direction;
    float avg = (P.r + N.r + P.g + N.g + P.b + N.b) / 6.0;
    light += hemisphereLights[i].skyColor * mix(avg, sixway(up), 0.5);
    light += hemisphereLights[i].groundColor * mix(avg, sixway(-up), 0.5);
  }
  #endif
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    light += directionalLights[i].color * sixway(directionalLights[i].direction);
  }
  #endif
  #if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 lv = pointLights[i].position - vViewPos;
    float d = length(lv);
    float att = getDistanceAttenuation(d, pointLights[i].distance, pointLights[i].decay);
    light += pointLights[i].color * att * sixway(lv / max(d, 1e-4));
  }
  #endif
  gl_FragColor = vec4(albedo * light * gain * RECIPROCAL_PI, alpha);
  #include <colorspace_fragment>
}`;

/** A six-way lit smoke material for one puff. */
export function makeSixWayMaterial(color) {
  const m = sixwayMaps();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      {
        posMap: { value: null },
        negMap: { value: null },
        albedo: { value: new THREE.Color(color) },
        opacity: { value: 1 },
        frame: { value: 0 },
        grid: { value: new THREE.Vector2(m.bake.cols, m.bake.rows) },
        frames: { value: m.bake.frames },
        rot: { value: 0 },
        gain: { value: 1.6 },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    lights: true,
    transparent: true,
    depthWrite: false,
  });
  // UniformsUtils.merge clones textures; share the baked ones instead.
  mat.uniforms.posMap.value = m.pos;
  mat.uniforms.negMap.value = m.neg;
  return mat;
}
