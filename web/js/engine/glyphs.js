// Comic glyphs for sparks with `look: "glyph"`: little symbols that float
// over a status effect's victim (sleepy Zs, dizzy stars, question marks,
// hearts, skulls, ghosts...). Each is drawn once on a canvas: the red channel
// is the glyph's fill and the green channel its outline, so the shader can
// color them with the layer's two palette colors. Drawn as camera-facing
// point sprites, so every glyph reads upright in all four views.

import * as THREE from "three";

export { GLYPHS } from "./status.js";

const S = 128;
const FILL = "rgb(255,0,0)";
const LINE = "rgb(0,255,0)";

function star(g, cx, cy, r1, r2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

// Draw a path twice: a wide outline stroke, then the fill (or a narrower
// fill stroke for line glyphs).
function inked(g, path, { fill = true, line = 14, inner = 0 } = {}) {
  g.lineJoin = g.lineCap = "round";
  path();
  g.strokeStyle = LINE;
  g.lineWidth = line;
  g.stroke();
  if (fill) {
    path();
    g.fillStyle = FILL;
    g.fill();
  }
  if (inner) {
    path();
    g.strokeStyle = FILL;
    g.lineWidth = inner;
    g.stroke();
  }
}

const DRAW = {
  z(g) {
    const pts = [[30, 28], [98, 28], [98, 42], [52, 88], [100, 88], [100, 102], [28, 102], [28, 88], [74, 42], [30, 42]];
    inked(g, () => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    }, { line: 12 });
  },
  star(g) {
    inked(g, () => star(g, 64, 68, 52, 22), { line: 12 });
  },
  question(g) {
    const path = () => {
      g.beginPath();
      g.arc(64, 44, 24, Math.PI * 1.05, Math.PI * 2.35);
      g.quadraticCurveTo(64, 70, 64, 82);
    };
    inked(g, path, { fill: false, line: 30, inner: 16 });
    inked(g, () => {
      g.beginPath();
      g.arc(64, 106, 9, 0, Math.PI * 2);
    }, { line: 12 });
  },
  exclaim(g) {
    inked(g, () => {
      g.beginPath();
      g.moveTo(52, 16);
      g.lineTo(76, 16);
      g.lineTo(70, 82);
      g.lineTo(58, 82);
      g.closePath();
    }, { line: 12 });
    inked(g, () => {
      g.beginPath();
      g.arc(64, 104, 10, 0, Math.PI * 2);
    }, { line: 12 });
  },
  heart(g) {
    inked(g, () => {
      g.beginPath();
      g.moveTo(64, 110);
      g.bezierCurveTo(10, 72, 18, 20, 64, 42);
      g.bezierCurveTo(110, 20, 118, 72, 64, 110);
      g.closePath();
    }, { line: 12 });
  },
  skull(g) {
    inked(g, () => {
      g.beginPath();
      g.arc(64, 56, 38, Math.PI * 0.8, Math.PI * 2.2);
      g.lineTo(88, 100);
      g.lineTo(40, 100);
      g.closePath();
    }, { line: 12 });
    // Eye holes, nose and teeth in the outline color.
    g.fillStyle = LINE;
    for (const x of [48, 80]) {
      g.beginPath();
      g.ellipse(x, 60, 11, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(64, 72);
    g.lineTo(58, 84);
    g.lineTo(70, 84);
    g.closePath();
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = LINE;
    for (const x of [52, 64, 76]) {
      g.beginPath();
      g.moveTo(x, 90);
      g.lineTo(x, 100);
      g.stroke();
    }
  },
  bubble(g) {
    g.beginPath();
    g.arc(64, 64, 44, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,0,0,0.25)";
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = LINE;
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = FILL;
    g.stroke();
    g.beginPath();
    g.arc(48, 46, 9, 0, Math.PI * 2);
    g.fillStyle = FILL;
    g.fill();
  },
  ghost(g) {
    inked(g, () => {
      g.beginPath();
      g.moveTo(28, 110);
      g.lineTo(28, 56);
      g.arc(64, 56, 36, Math.PI, 0);
      g.lineTo(100, 110);
      for (let i = 0; i < 4; i++) {
        const x0 = 100 - i * 18;
        g.quadraticCurveTo(x0 - 9, i % 2 ? 120 : 96, x0 - 18, 110);
      }
      g.closePath();
    }, { line: 12 });
    g.fillStyle = LINE;
    for (const x of [50, 78]) {
      g.beginPath();
      g.ellipse(x, 58, 7, 11, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.ellipse(64, 84, 8, 10, 0, 0, Math.PI * 2);
    g.fill();
  },
  swirl(g) {
    inked(g, () => {
      g.beginPath();
      for (let i = 0; i <= 80; i++) {
        const a = (i / 80) * Math.PI * 5;
        const r = 4 + (i / 80) * 46;
        g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
    }, { fill: false, line: 22, inner: 9 });
  },
  hourglass(g) {
    inked(g, () => {
      g.beginPath();
      g.moveTo(32, 16);
      g.lineTo(96, 16);
      g.lineTo(96, 26);
      g.lineTo(68, 64);
      g.lineTo(96, 102);
      g.lineTo(96, 112);
      g.lineTo(32, 112);
      g.lineTo(32, 102);
      g.lineTo(60, 64);
      g.lineTo(32, 26);
      g.closePath();
    }, { line: 12 });
    // Sand in the outline color: falling through the neck, piled below.
    g.fillStyle = LINE;
    g.beginPath();
    g.moveTo(44, 104);
    g.lineTo(84, 104);
    g.lineTo(64, 84);
    g.closePath();
    g.fill();
    g.fillRect(62, 60, 4, 30);
  },
  mute(g) {
    inked(g, () => {
      g.beginPath();
      g.ellipse(64, 56, 46, 34, 0, 0, Math.PI * 2);
      g.moveTo(44, 84);
      g.lineTo(34, 110);
      g.lineTo(62, 88);
    }, { line: 12 });
    // A slash through it.
    g.lineCap = "round";
    g.strokeStyle = LINE;
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(26, 22);
    g.lineTo(102, 98);
    g.stroke();
  },
  drop(g) {
    inked(g, () => {
      g.beginPath();
      g.moveTo(64, 12);
      g.bezierCurveTo(70, 40, 98, 62, 98, 82);
      g.arc(64, 82, 34, 0, Math.PI);
      g.bezierCurveTo(30, 62, 58, 40, 64, 12);
      g.closePath();
    }, { line: 12 });
    g.fillStyle = "rgba(255,255,0,1)";
    g.beginPath();
    g.ellipse(52, 82, 6, 11, -0.3, 0, Math.PI * 2);
    g.fill();
  },
  fly(g) {
    // Two pale wings over a dark body.
    g.fillStyle = FILL;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(64 + s * 22, 46, 22, 14, s * -0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = LINE;
    g.beginPath();
    g.ellipse(64, 70, 16, 24, 0, 0, Math.PI * 2);
    g.fill();
  },
  anger(g) {
    // Four bent ticks around a centre: the comic "vein" mark.
    g.lineCap = "round";
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(64, 64);
      g.rotate((k * Math.PI) / 2);
      for (const [w, c] of [[18, LINE], [8, FILL]]) {
        g.beginPath();
        g.moveTo(12, -40);
        g.quadraticCurveTo(14, -14, 40, -12);
        g.strokeStyle = c;
        g.lineWidth = w;
        g.stroke();
      }
      g.restore();
    }
  },
};

const cache = new Map();

export function glyphTexture(name) {
  const key = DRAW[name] ? name : "star";
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  DRAW[key](g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  // Point sprites read gl_PointCoord from the top, like the canvas.
  tex.flipY = false;
  cache.set(key, tex);
  return tex;
}

const GLYPH_VERTEX = /* glsl */ `
attribute float size;
attribute float rot;
attribute float alpha;
uniform float scale;
varying float vRot;
varying float vAlpha;
void main() {
  vRot = rot;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = isOrthographic ? size * scale * projectionMatrix[1][1] : size * scale * projectionMatrix[1][1] / -mv.z;
}`;

const GLYPH_FRAGMENT = /* glsl */ `
uniform vec3 fillColor;
uniform vec3 lineColor;
uniform sampler2D map;
varying float vRot;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 uv = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 t = texture2D(map, uv);
  float cover = max(t.r, t.g);
  if (cover * t.a * vAlpha < 0.01) discard;
  vec3 col = mix(lineColor, fillColor, t.r / max(0.001, t.r + t.g));
  // A hint of yellow in the texture marks a highlight (a drop's shine).
  col = mix(col, vec3(1.0), clamp(t.r * t.g, 0.0, 1.0) * 0.8);
  gl_FragColor = vec4(col, cover * t.a * vAlpha);
  #include <colorspace_fragment>
}`;

// Camera-facing glyph sprites: set([{p, s (world size), rot, a}]).
export class GlyphPoints {
  constructor(capacity, name, fill, line, additive = false) {
    this.capacity = capacity;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.rot = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.alpha = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("size", this.size);
    geo.setAttribute("rot", this.rot);
    geo.setAttribute("alpha", this.alpha);
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERTEX,
      fragmentShader: GLYPH_FRAGMENT,
      uniforms: {
        fillColor: { value: new THREE.Color(fill) },
        lineColor: { value: new THREE.Color(line) },
        map: { value: glyphTexture(name) },
        scale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer) => {
      const vp = new THREE.Vector4();
      renderer.getCurrentViewport(vp);
      this.material.uniforms.scale.value = vp.w / 2;
    };
    geo.setDrawRange(0, 0);
  }

  set(list) {
    const n = Math.min(this.capacity, list.length);
    for (let i = 0; i < n; i++) {
      const g = list[i];
      this.pos.array[i * 3] = g.p.x;
      this.pos.array[i * 3 + 1] = g.p.y;
      this.pos.array[i * 3 + 2] = g.p.z;
      this.size.array[i] = g.s;
      this.rot.array[i] = g.rot;
      this.alpha.array[i] = g.a;
    }
    this.pos.needsUpdate = this.size.needsUpdate = this.rot.needsUpdate = this.alpha.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
  }
}
