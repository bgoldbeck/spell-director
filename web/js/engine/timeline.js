// Pure timeline math: seeded randomness, param resolution, beat curves,
// keyframes. No Three.js here so it can be unit-tested in Node.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for visuals, fully deterministic.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + (max - min) * next();
  next.int = (min, max) => Math.floor(min + (max - min + 1) * next());
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}

export function seedFor(seed, ...parts) {
  return hashString(`${seed}|${parts.join("|")}`);
}

export function isRange(v) {
  return v !== null && typeof v === "object" && "min" in v && "max" in v;
}

// Pick a concrete value for every param. Ranges are resolved from the seed,
// so the same seed always gives the same cast.
export function resolveParams(params = {}, seed, layerId) {
  const r = rng(seedFor(seed, layerId, "params"));
  const out = {};
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    out[key] = isRange(v) ? r.range(v.min, v.max) : v;
  }
  return out;
}

export function resolveValue(v, seed, ...parts) {
  if (!isRange(v)) return v;
  return rng(seedFor(seed, ...parts)).range(v.min, v.max);
}

export const ease = {
  linear: (u) => u,
  ease_in: (u) => u * u,
  ease_out: (u) => 1 - (1 - u) * (1 - u),
  ease_in_out: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  step: (u) => (u < 1 ? 0 : 1),
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Intensity of a beat at time t (ms). 0 outside the beat.
export function beatIntensity(beat, t, seed = 0) {
  if (t < beat.start_ms || t > beat.end_ms) return 0;
  const span = Math.max(1, beat.end_ms - beat.start_ms);
  const u = clamp01((t - beat.start_ms) / span);
  const c = beat.intensity || { shape: "hold", from: 1 };
  const from = c.from ?? 1;
  const to = c.to ?? from;
  switch (c.shape) {
    case "linear":
    case "ease_in":
    case "ease_out":
    case "ease_in_out":
      return from + (to - from) * ease[c.shape](u);
    case "spike": {
      // Instant jump to `from`, exponential settle toward `to`.
      return to + (from - to) * Math.exp(-5 * u);
    }
    case "flicker": {
      const hz = c.flicker_hz || 12;
      const tick = Math.floor(((t - beat.start_ms) / 1000) * hz * 2);
      const r = rng(seedFor(seed, beat.id, "flicker", tick))();
      // Alternate high/low half-cycles with a little noise.
      const high = tick % 2 === 0;
      const base = high ? to : from;
      return clamp01(base + (r - 0.5) * 0.15);
    }
    case "hold":
    default:
      return from;
  }
}

export function beatsAt(template, t) {
  return template.beats.filter((b) => t >= b.start_ms && t <= b.end_ms);
}

// Layer is visible while any of its beats is active; its intensity is the
// strongest of those beats.
export function layerWindow(template, layer) {
  const beats = template.beats.filter((b) => layer.beats.includes(b.id));
  if (!beats.length) return null;
  return {
    start: Math.min(...beats.map((b) => b.start_ms)),
    end: Math.max(...beats.map((b) => b.end_ms)),
    beats,
  };
}

export function layerIntensity(template, layer, t, seed = 0) {
  let best = 0;
  for (const b of template.beats) {
    if (!layer.beats.includes(b.id)) continue;
    best = Math.max(best, beatIntensity(b, t, seed));
  }
  return best;
}

// Param value at time t, with keyframes eased between. Before the first
// keyframe the base value holds; after the last, the last value holds.
export function paramAt(base, keyframes, param, t) {
  const kfs = (keyframes || []).filter((k) => k.param === param).sort((a, b) => a.t_ms - b.t_ms);
  if (!kfs.length) return base[param];
  if (t <= kfs[0].t_ms) {
    if (kfs[0].t_ms === 0 || base[param] === undefined) return kfs[0].value;
    return base[param];
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t_ms && t <= b.t_ms) {
      const u = (t - a.t_ms) / Math.max(1, b.t_ms - a.t_ms);
      return a.value + (b.value - a.value) * (ease[b.ease || "linear"] || ease.linear)(u);
    }
  }
  // Ease from the base value into a lone first keyframe? No: a keyframe is a
  // target reached at its time, starting from the previous keyframe or base.
  return kfs[kfs.length - 1].value;
}

// Like paramAt, but eases from the base value into the first keyframe from
// the start of the layer window. Used for keyframes that shrink/grow things.
export function paramAtFrom(base, keyframes, param, t, windowStart) {
  const kfs = (keyframes || []).filter((k) => k.param === param).sort((a, b) => a.t_ms - b.t_ms);
  if (!kfs.length) return base[param];
  const first = kfs[0];
  if (t < first.t_ms && base[param] !== undefined && first.t_ms > windowStart) {
    const u = clamp01((t - windowStart) / (first.t_ms - windowStart));
    return base[param] + (first.value - base[param]) * (ease[first.ease || "linear"] || ease.linear)(u);
  }
  return paramAt(base, keyframes, param, t);
}

export function phaseColor(phase) {
  return (
    {
      anticipation: "#5a8cff",
      release: "#ffffff",
      travel: "#5fd0c0",
      impact: "#ffc83c",
      dissipation: "#a07ad0",
    }[phase] || "#888888"
  );
}
