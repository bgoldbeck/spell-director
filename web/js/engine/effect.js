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

function decalTexture(seed, shape) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  if (shape === "cracks") {
    const r = rng(seedFor(seed, "decal"));
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      let a = r.range(0, Math.PI * 2);
      let x = 128;
      let y = 128;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        a += r.range(-0.6, 0.6);
        const len = r.range(10, 22);
        x += Math.cos(a) * len;
        y += Math.sin(a) * len;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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

// Instanced cylinders: one draw call for many line segments of any width.
class SegmentMesh {
  constructor(capacity, color, opacity) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.capacity = capacity;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  set(segs, radius) {
    let n = 0;
    for (const s of segs) {
      if (n >= this.capacity) break;
      this._d.subVectors(s.b, s.a);
      const len = this._d.length();
      if (len < 1e-5) continue;
      this._q.setFromUnitVectors(UP, this._d.normalize());
      const rr = Math.max(0.0005, radius * s.w);
      this._s.set(rr, len, rr);
      this._m.compose(s.a, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
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
    this.core = new SegmentMesh(600, core, 1);
    this.outer = new SegmentMesh(600, outer, 0.85);
    this.glow = new SegmentMesh(600, secondary, 0.22);
    this.group.add(this.glow.mesh, this.outer.mesh, this.core.mesh);
    this.segs = [];
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
    const hops = this.endpoints();
    const isChain = this.effect.template.space.travel === "chain" && hops.length > 1;
    let segs = [];
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
    this.core.set(segs, width * 0.18);
    this.outer.set(segs, width * 0.45);
    this.glow.set(segs, Math.max(width, glowPx));
    this.core.material.opacity = Math.min(1, I * 1.1);
    this.outer.material.opacity = 0.85 * I;
    this.glow.material.opacity = 0.18 * I;
  }

  points() {
    const pts = [];
    this.segs.forEach((s, i) => {
      if (i % 3 === 0) pts.push(s.a);
    });
    return pts;
  }
}

class CrackleLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.core = new SegmentMesh(300, this.colors[0].clone().lerp(new THREE.Color("#ffffff"), 0.5), 1);
    this.outer = new SegmentMesh(300, this.colors[1], 0.6);
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
    this.core.set(segs, 0.006);
    this.outer.set(segs, 0.016);
    this.core.material.opacity = Math.min(1, I * 1.2);
    this.outer.material.opacity = 0.6 * I;
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
    this.material.opacity = Math.min(1, I * (pts.length > 1 ? 0.35 : 0.9));
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

class SparksLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.max = 200;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.max * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.max * 3), 3));
    this.points3 = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.05, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: soft(),
    }));
    this.points3.frustumCulled = false;
    this.group.add(this.points3);
  }

  update(t) {
    const w = this.window;
    const geo = this.points3.geometry;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
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
    const sz = this.p("size_px", 0, 3);
    const span = Math.max(1, Math.min(w.end - w.start, 120));
    let n = 0;
    for (let i = 0; i < count; i++) {
      const born = r.range(0, span);
      const lifeI = life * r.range(0.7, 1.2);
      const theta = r.range(0, Math.PI * 2);
      const cone = THREE.MathUtils.degToRad(spreadDeg / 2);
      const phi = spreadDeg >= 360 ? Math.acos(r.range(-1, 1)) : r.range(0, Math.min(Math.PI, cone));
      const v = speed * (1 + r.range(-spread, spread));
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const age = (local - born) / 1000;
      const alive = age >= 0 && age * 1000 <= lifeI;
      let px = 0;
      let py = 0;
      let pz = 0;
      let a = 0;
      if (alive) {
        const travel = (v * (1 - Math.exp(-drag * age))) / drag;
        px = origin.x + dir.x * travel;
        py = Math.max(0.01, origin.y + dir.y * travel - 0.5 * gravity * age * age);
        pz = origin.z + dir.z * travel;
        a = 1 - (age * 1000) / lifeI;
      }
      pos[n * 3] = px;
      pos[n * 3 + 1] = py;
      pos[n * 3 + 2] = pz;
      const c = this.colors[1];
      col[n * 3] = c.r * a;
      col[n * 3 + 1] = c.g * a;
      col[n * 3 + 2] = c.b * a;
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    this.points3.material.size = sz * PX * 3.2;
  }
}

class RingLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.material = new THREE.MeshBasicMaterial({
      color: this.colors[1], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 72), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.group.add(this.mesh);
    this._thick = null;
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
    const thick = Math.min(0.95, (this.p("thickness_px", t, 5) * PX) / Math.max(0.01, radius));
    if (this._thick === null || Math.abs(thick - this._thick) > 0.02) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.RingGeometry(1 - thick, 1, 72);
      this._thick = thick;
    }
    const at = this.anchorPos();
    this.mesh.position.set(at.x, 0.02, at.z);
    this.mesh.scale.setScalar(radius);
    this.material.opacity = I * (1 - u * 0.7);
  }
}

class DecalLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.material = new THREE.MeshBasicMaterial({
      map: decalTexture(effect.seed + instance, this.base.shape), color: this.colors[0], transparent: true,
      depthWrite: false, opacity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.group.add(this.mesh);
  }

  update(t) {
    const w = this.window;
    if (!w) return;
    const fade = this.p("fade_ms", t, 400);
    let o = 0;
    if (t >= w.start && t <= w.end) o = 0.85;
    else if (t > w.end && t < w.end + fade) o = 0.85 * (1 - (t - w.end) / fade);
    this.group.visible = o > 0.001;
    const at = this.anchorPos();
    this.mesh.position.set(at.x, 0.012, at.z);
    this.mesh.scale.setScalar(this.p("radius_px", t, 40) * PX * 2.2);
    this.material.opacity = Math.max(0, o);
  }
}

class SmokeLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.sprites = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: this.colors[0], transparent: true, depthWrite: false }));
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
      const age = (local - born) / life;
      s.visible = i < count && age >= 0 && age <= 1;
      if (!s.visible) return;
      s.position.set(origin.x + dx * (1 + age), origin.y + 0.1 + rise * age * (life / 1000) * 3, origin.z + dz * (1 + age));
      s.scale.setScalar(size * (0.6 + age));
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
    this.arcs = new SegmentMesh(200, this.colors[1].clone().lerp(new THREE.Color("#fff"), 0.4), 1);
    this.group.add(this.shell, this.core, this.arcs.mesh);
    this.currentRadius = 0;
  }

  update(t) {
    const I = this.intensityAt(t);
    this.group.visible = I > 0.001;
    if (!this.group.visible) {
      this.currentRadius = 0;
      return;
    }
    const at = this.anchorPos();
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
    this.arcs.set(segs, 0.007);
    this.arcs.material.opacity = I;
  }

  points() {
    return [this.anchorPos()];
  }
}

class BeamLayer extends Layer {
  constructor(effect, def, instance) {
    super(effect, def, instance);
    this.core = new SegmentMesh(120, this.colors[0], 1);
    this.outer = new SegmentMesh(120, this.colors[1], 0.8);
    this.group.add(this.outer.mesh, this.core.mesh);
    this.segs = [];
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
      return;
    }
    const [[a, b]] = this.endpoints();
    const regen = this.p("regen_ms", t, 50);
    const tick = Math.floor(Math.max(0, this.local(t)) / Math.max(10, regen));
    const r = this.rng("beam", tick);
    const n = 24;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const [p1, p2] = perpendiculars(dir);
    const wob = this.p("wobble", t, 0.2);
    const hz = this.p("wobble_hz", t, 8);
    const jag = this.p("jaggedness", t, 0.2);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const env = Math.sin(Math.PI * u) * 0.8 + 0.2;
      const s = Math.sin(u * 9 + (t / 1000) * hz * Math.PI * 2) * wob * 0.12 * env;
      const j = r.range(-1, 1) * jag * 0.06 * env;
      pts.push(a.clone().addScaledVector(dir, len * u).addScaledVector(p1, s + j).addScaledVector(p2, r.range(-1, 1) * jag * 0.04 * env));
    }
    // Snap out to full length during the first 60 ms of the beam.
    const grow = Math.min(1, Math.max(0.05, this.local(t) / 60));
    const shown = Math.max(2, Math.round(pts.length * grow));
    const segs = [];
    for (let i = 0; i < shown - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], w: 1 });
    this.segs = segs;
    const width = this.p("width_px", t, 14) * PX;
    this.core.set(segs, width * 0.22);
    this.outer.set(segs, width * 0.5);
    this.core.material.opacity = Math.min(1, I * 1.1);
    this.outer.material.opacity = 0.75 * I;
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
        layer.group.renderOrder = def.z ?? 0;
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
