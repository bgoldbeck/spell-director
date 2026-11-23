// Readability: how a spell should read on screen, and how its layers move
// when the actors they sit on move. Pure (Node-testable): used by the sprite
// export's manifest and guide and by the range guide (web/js/rangeguide.js,
// tools/range_guide.py).
//
// Template fields (docs/template-format.md#readability):
//   readability.reference_distance  units the look is judged at (default: the footprint length)
//   readability.view_distances      camera distances to check it at, in units (default 3, 6, 12, 20)
//   readability.must_read           [{cue, layers, beat?, at_ms?, measure?, why?}]: what must survive at gameplay distance
//   readability.key_frames          [{label, t_ms, note?}]: moments to judge the quality target by
//   layers[].tracking               follow | trail | stay (see TRACKING)
//
// 1 world unit is one character height (docs/DESIGN.md), not a metre.

export const CHARACTER_M = 1.8; // a typical human character, for metre read-outs only
export const DEFAULT_VIEW_DISTANCES = [3, 6, 12, 20];
export const SCREEN = { height_px: 1080, vfov_deg: 60 }; // a common 1080p third-person camera

// How a layer moves when the actor it sits on moves (pushed back, walking,
// a projectile target dodging). The viewer's actors barely move, so this is
// mostly an instruction for the engine rebuild.
export const TRACKING = {
  follow: {
    label: "follows the actor",
    about: "Rides on its anchor: when the actor moves, the whole layer moves with it.",
    unity: "Parent it to the anchor's bone or transform. Particle systems: Simulation Space Local.",
    godot: "Make it a child of the anchor's node (a BoneAttachment3D for a bone). GPUParticles3D: local_coords on.",
  },
  trail: {
    label: "emitter follows, particles stay",
    about: "The emitter rides on its anchor, but each particle stays where it was emitted: embers and smoke stream off a moving actor instead of being dragged along.",
    unity: "Parent the emitter to the anchor, but set the particle system's Simulation Space to World.",
    godot: "Make the emitter a child of the anchor's node with local_coords off, so particles live in world space.",
  },
  stay: {
    label: "stays where it landed",
    about: "Placed once where its anchor was when it started, then left there: it does not move with the actor (a scorch mark, a crater, a puddle).",
    unity: "Spawn it unparented (world space) at the anchor's position when it starts; don't parent it to the actor.",
    godot: "Add it to the level (not the actor) at the anchor's global position when it starts.",
  },
};
export const TRACKING_KINDS = Object.keys(TRACKING);

const NOT_SPATIAL = new Set(["sound_cue", "camera_shake"]);

// The tracking a layer gets when the template doesn't say.
export function defaultTracking(layer) {
  if (NOT_SPATIAL.has(layer.type)) return null;
  if (layer.type === "flash" && layer.params?.scope === "screen") return null;
  if (layer.type === "decal" || layer.type === "eruption") return "stay";
  const p = layer.params || {};
  if ((layer.type === "sparks" || layer.type === "smoke") && !layer.attach_to && !p.steady && !p.home_to && !p.orbit_hz) return "trail";
  return "follow";
}

export function trackingFor(layer) {
  if (NOT_SPATIAL.has(layer.type)) return null;
  return TRACKING[layer.tracking] ? layer.tracking : defaultTracking(layer);
}

// Default key-frame labels by beat phase.
const PHASE_FRAME = {
  release: "release",
  impact: "first contact",
  dissipation: "shutdown",
};

// The key frames to judge a spell by: the template's, or one each at the
// start of its first release and impact beats and partway into its first
// dissipation beat.
export function keyFrames(template) {
  const authored = template.readability?.key_frames;
  if (authored?.length) return authored.map((k) => ({ label: k.label, t_ms: k.t_ms, note: k.note || "", source: "template" }));
  const beats = template.beats || [];
  const out = [];
  for (const [phase, label] of Object.entries(PHASE_FRAME)) {
    const b = beats.find((x) => x.phase === phase);
    if (!b) continue;
    const span = b.end_ms - b.start_ms;
    const t = phase === "dissipation" ? b.start_ms + span * 0.4 : b.start_ms + Math.min(40, span / 2);
    out.push({ label, t_ms: Math.round(t), note: b.intent || "", beat: b.id, source: "derived" });
  }
  if (!out.length) out.push({ label: "middle", t_ms: Math.round((template.timing?.duration_ms || 1000) / 2), note: "", source: "derived" });
  return out.sort((a, b) => a.t_ms - b.t_ms);
}

// Everything the range guide and the export need, with defaults filled in.
export function resolveReadability(template) {
  const r = template.readability || {};
  const fp = template.space?.footprint || {};
  const num = (v) => (typeof v === "number" ? v : v && typeof v === "object" ? (v.min + v.max) / 2 : undefined);
  const footprint = num(fp.length) ?? num(fp.radius);
  const reference = r.reference_distance ?? footprint ?? 4;
  return {
    reference_distance: reference,
    reference_source: r.reference_distance != null ? "readability.reference_distance" : footprint != null ? `space.footprint.${num(fp.length) != null ? "length" : "radius"}` : "default",
    view_distances: (r.view_distances?.length ? r.view_distances : DEFAULT_VIEW_DISTANCES).slice().sort((a, b) => a - b),
    must_read: (r.must_read || []).map((c) => ({ cue: c.cue, layers: c.layers || [], beat: c.beat || null, at_ms: c.at_ms ?? null, measure: c.measure || null, why: c.why || "" })),
    key_frames: keyFrames(template),
    authored: !!template.readability,
  };
}

// On-screen size in pixels of something `size` units across seen from
// `distance` units away with a perspective camera.
export function screenPx(size, distance, screen = SCREEN) {
  const visibleH = 2 * distance * Math.tan((screen.vfov_deg * Math.PI) / 360);
  return (size / visibleH) * screen.height_px;
}

// How a feature that many pixels wide reads.
export const BANDS = [
  { max: 1, id: "lost", label: "lost (under a pixel)" },
  { max: 3, id: "flicker", label: "flickers (1-3 px, aliases as it moves)" },
  { max: 8, id: "line", label: "thin line (3-8 px)" },
  { max: Infinity, id: "shape", label: "reads as a shape (8 px or more)" },
];
export function band(px) {
  return BANDS.find((b) => px < b.max);
}

// The furthest distance (units) at which `size` still reaches `minPx`.
export function readsUntil(size, minPx = 3, screen = SCREEN) {
  if (!(size > 0)) return 0;
  return size / (2 * Math.tan((screen.vfov_deg * Math.PI) / 360)) * screen.height_px / minPx;
}

// ------------------------------------------------------------ pixel measuring
// Masks are Uint8Array(w*h), 1 = set. Images are RGBA Uint8(Clamped)Array.

// Pixels that differ from the background `ref` by more than `thresh` in any channel.
export function visibleMask(px, ref, w, h, thresh = 24) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    if (Math.abs(px[j] - ref[j]) > thresh || Math.abs(px[j + 1] - ref[j + 1]) > thresh || Math.abs(px[j + 2] - ref[j + 2]) > thresh) m[i] = 1;
  }
  return m;
}

// The hot core: pixels near full brightness (luminance, rendered on black,
// without bloom): the white-hot thread of a jet, a bolt's spine.
export function coreMask(px, w, h, thresh = 205) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    if (0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2] > thresh) m[i] = 1;
  }
  return m;
}

// Thickness of a mask at column x (± half pixels around it): the longest
// run of set rows, bridging gaps of up to `gap` rows, so a stray spark above
// a beam doesn't count as beam. null if empty.
export function columnExtent(mask, w, h, x, half = 2, gap = 3) {
  let best = null;
  let start = -1;
  let last = -Infinity;
  for (let y = 0; y < h; y++) {
    let on = false;
    for (let cx = Math.max(0, x - half); cx <= Math.min(w - 1, x + half) && !on; cx++) on = mask[y * w + cx] === 1;
    if (!on) continue;
    if (y - last > gap + 1) start = y;
    last = y;
    if (!best || last - start + 1 > best.px) best = { y0: start, y1: last, px: last - start + 1 };
  }
  return best;
}

// Bounding box of the set pixels with x in [xa, xb]. null if empty.
export function boxIn(mask, w, h, xa = 0, xb = w - 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 >= x0 ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}

export function countSet(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

// The median of the present values, or null.
export function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}
