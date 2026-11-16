// Plays sound cue events (see engine/sound.js) with Web Audio, and renders
// them offline to WAV for exports.
//
// Each cue in web/sounds/cues.json plays a real sample when the cue lists
// `samples`, and otherwise a procedural placeholder from RECIPES below (keyed
// by cue id). Replacing a placeholder never needs code: add files to
// web/sounds/samples/ and list them on the cue.
//
// Playback is a side effect of the clock only: main.js hands over the events
// whose start time was crossed this frame. Rendering never reads audio state.

import { rng } from "./engine/timeline.js";
import { eventSeed } from "./engine/sound.js";

const MASTER_GAIN = 0.7;

// How much of each cue goes to the shared reverb (0-1). Big, dark or airy
// cues get more room; tight hits stay dry so they keep their punch.
const REVERB_SEND = {
  boom: 0.32, crack: 0.28, rumble: 0.18, crash: 0.22, shatter: 0.3, shimmer: 0.4, charge: 0.2,
  drone: 0.45, whisper: 0.38, drain: 0.3, heartbeat: 0.06, impact: 0.12, squelch: 0.06,
  splash: 0.18, freeze: 0.3, wind: 0.2, whoosh: 0.15, zap: 0.2,
};
const DEFAULT_SEND = 0.14;

// ------------------------------------------------------------ building blocks

// White, pink and brown noise, 2 s each, cached per sample rate. An
// AudioBuffer can be played by any context, so live and offline share them.
const noiseBufs = new Map();
function noiseBuffer(ctx, color = "white") {
  const key = `${color}@${ctx.sampleRate}`;
  if (noiseBufs.has(key)) return noiseBufs.get(key);
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const r = rng(color === "white" ? 1234 : color === "pink" ? 5678 : 9012);
  if (color === "pink") {
    // Paul Kellet's economy pink filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else if (color === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
  }
  noiseBufs.set(key, buf);
  return buf;
}

function noise(v, t0, d, color = "white") {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx, color);
  src.loop = true;
  src.start(t0, v.rand() * 1.5);
  src.stop(t0 + d + 0.05);
  return src;
}

function osc(v, type, freq, t0, d) {
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t0 + d + 0.05);
  return o;
}

function filter(v, type, freq, q = 1) {
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  // Anchor at the voice start so later ramps run from there, live or offline.
  f.frequency.setValueAtTime(freq, v.t0 ?? v.ctx.currentTime);
  f.Q.value = q;
  return f;
}

function gain(v, value = 0) {
  const g = v.ctx.createGain();
  g.gain.value = value;
  return g;
}

// Soft clipper: adds harmonics so low sounds read on small speakers.
const curves = new Map();
function drive(v, amount = 2) {
  if (!curves.has(amount)) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    curves.set(amount, c);
  }
  const s = v.ctx.createWaveShaper();
  s.curve = curves.get(amount);
  s.oversample = "2x";
  return s;
}

// Chain nodes left to right and into the voice output.
function chain(v, ...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  nodes[nodes.length - 1].connect(v.out);
  return nodes;
}

// Attack / hold / release envelope on a gain param.
function envelope(param, t0, d, peak, attack, release) {
  const a = Math.min(attack, d / 2);
  const rel = Math.min(release, d - a);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  param.setValueAtTime(peak, t0 + d - rel);
  param.linearRampToValueAtTime(0, t0 + d);
}

// Fast hit, exponential decay.
function hit(param, t0, peak, tau) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + 0.003);
  param.setTargetAtTime(0, t0 + 0.003, tau);
}

// Random short pops on a gain param: crackle, debris, embers.
// rise > 0 makes them denser toward the end (ice spreading).
function pops(v, param, t0, d, perSecond, { peak = [0.3, 1], tau = [0.004, 0.02], fade = 0, rise = 0 } = {}) {
  param.setValueAtTime(0, t0);
  const n = Math.max(1, Math.round(d * perSecond));
  const times = Array.from({ length: n }, () => t0 + Math.pow(v.rand(), 1 / (1 + rise)) * d).sort((a, b) => a - b);
  for (const tp of times) {
    const u = (tp - t0) / d;
    const p = (peak[0] + v.rand() * (peak[1] - peak[0])) * (1 - fade * u);
    param.setValueAtTime(p, tp);
    param.setTargetAtTime(0, tp + 0.001, tau[0] + v.rand() * (tau[1] - tau[0]));
  }
}

// Slow random wander on a param between lo and hi.
function wander(v, param, t0, d, lo, hi, step = 0.15) {
  param.setValueAtTime(lo + (hi - lo) * v.rand(), t0);
  for (let t = t0 + step; t < t0 + d; t += step) param.setTargetAtTime(lo + (hi - lo) * v.rand(), t, step / 2);
}

function thump(v, t0, from, to, sweep, peak, tau) {
  const o = osc(v, "sine", from * v.rate, t0, sweep + tau * 6);
  o.frequency.exponentialRampToValueAtTime(to * v.rate, t0 + sweep);
  const g = gain(v);
  hit(g.gain, t0, peak, tau);
  chain(v, o, g);
}

// A tiny rising sine chirp: a water drop or bubble.
function bloop(v, at, from, to, len, peak) {
  const o = osc(v, "sine", from * v.rate, at, len);
  o.frequency.exponentialRampToValueAtTime(to * v.rate, at + len);
  const g = gain(v);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  chain(v, o, g);
}

// ------------------------------------------------------------ placeholder recipes
// Each gets a voice v = {ctx, out, t0, rate, rand} and plays from t0 for d seconds.
// docs/sound-design.md and each cue's `synth` field describe the same recipes in words.

export const RECIPES = {
  charge(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 300 * r, 5);
    lp.frequency.exponentialRampToValueAtTime(3200 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + d * 0.96);
    g.gain.linearRampToValueAtTime(0, t0 + d);
    // Tremolo that speeds up as it builds.
    const trem = gain(v, 0.75);
    const lfo = osc(v, "sine", 4, t0, d);
    lfo.frequency.exponentialRampToValueAtTime(18, t0 + d);
    const depth = gain(v, 0.25);
    lfo.connect(depth).connect(trem.gain);
    for (const det of [1, 1.006, 0.5]) {
      const o = osc(v, "sawtooth", 110 * r * det, t0, d);
      o.frequency.exponentialRampToValueAtTime(440 * r * det, t0 + d);
      o.connect(lp);
    }
    chain(v, lp, trem, g);
    const bp = filter(v, "bandpass", 800 * r, 2);
    bp.frequency.exponentialRampToValueAtTime(5000 * r, t0 + d);
    const ng = gain(v);
    ng.gain.setValueAtTime(0.001, t0);
    ng.gain.exponentialRampToValueAtTime(0.3, t0 + d * 0.96);
    ng.gain.linearRampToValueAtTime(0, t0 + d);
    chain(v, noise(v, t0, d, "pink"), bp, ng);
  },

  hum(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 420 * r, 1);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.25, 0.08, 0.15);
    const trem = gain(v, 1);
    const lfo = osc(v, "sine", 5, t0, d);
    const depth = gain(v, 0.2);
    lfo.connect(depth).connect(trem.gain);
    for (const [type, f] of [["sawtooth", 55], ["sawtooth", 55.6], ["sine", 110], ["triangle", 165.3]]) osc(v, type, f * r, t0, d).connect(lp);
    chain(v, lp, drive(v, 1.5), trem, g);
  },

  buzz(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 1300 * r, 0.9);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.32, 0.02, 0.06);
    const jitter = gain(v, 0.7);
    wander(v, jitter.gain, t0, d, 0.35, 1, 0.025);
    osc(v, "sawtooth", 100 * r, t0, d).connect(bp);
    osc(v, "sawtooth", 150.5 * r, t0, d).connect(bp);
    osc(v, "square", 50 * r, t0, d).connect(bp);
    chain(v, bp, drive(v, 3), jitter, g);
    // A little static riding on top.
    const st = gain(v);
    pops(v, st.gain, t0, d, 14, { peak: [0.03, 0.1], tau: [0.002, 0.006] });
    chain(v, noise(v, t0, d), filter(v, "highpass", 3000 * r), st);
  },

  crackle(v, t0, d) {
    const hp = filter(v, "highpass", 2200 * v.rate, 0.7);
    const g = gain(v);
    pops(v, g.gain, t0, d, 34, { peak: [0.15, 0.9], tau: [0.002, 0.01] });
    chain(v, noise(v, t0, d), hp, g);
    // A few lower, meatier snaps.
    const lo = gain(v);
    pops(v, lo.gain, t0, d, 6, { peak: [0.2, 0.5], tau: [0.004, 0.012] });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 1200 * v.rate, 1.5), lo);
  },

  sizzle(v, t0, d) {
    const hp = filter(v, "highpass", 4500 * v.rate, 0.8);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.26, 0.03, 0.12);
    const flutter = gain(v, 0.6);
    wander(v, flutter.gain, t0, d, 0.25, 1, 0.04);
    chain(v, noise(v, t0, d), hp, flutter, g);
    const p = gain(v);
    pops(v, p.gain, t0, d, 10, { peak: [0.1, 0.3], tau: [0.002, 0.005] });
    chain(v, noise(v, t0, d), filter(v, "highpass", 6000 * v.rate), p);
  },

  zap(v, t0, d) {
    const r = v.rate;
    const o = osc(v, "sawtooth", 1800 * r, t0, d);
    o.frequency.exponentialRampToValueAtTime(140 * r, t0 + d);
    const o2 = osc(v, "square", 1780 * r, t0, d);
    o2.frequency.exponentialRampToValueAtTime(150 * r, t0 + d);
    const lp = filter(v, "lowpass", 5000 * r, 1);
    const g = gain(v);
    hit(g.gain, t0, 0.22, d / 3);
    o.connect(lp);
    o2.connect(lp);
    chain(v, lp, g);
    const ng = gain(v);
    hit(ng.gain, t0, 0.35, 0.012);
    chain(v, noise(v, t0, 0.08), filter(v, "highpass", 3000 * r), ng);
  },

  crack(v, t0, d) {
    const r = v.rate;
    // The snap: full-band, very short.
    const g = gain(v);
    hit(g.gain, t0, 1, 0.025);
    chain(v, noise(v, t0, d), filter(v, "highpass", 500 * r), drive(v, 2.5), g);
    // The rip: a fast burst of crackles tearing the air.
    const rip = gain(v);
    pops(v, rip.gain, t0 + 0.004, 0.05, 220, { peak: [0.4, 1], tau: [0.002, 0.006] });
    chain(v, noise(v, t0, 0.1), filter(v, "bandpass", 3500 * r, 0.8), rip);
    // The ring-out.
    const ring = gain(v);
    hit(ring.gain, t0, 0.45, d / 4);
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2400 * r, 1.5), ring);
    thump(v, t0, 160, 55, 0.09, 0.7, 0.07);
  },

  boom(v, t0, d) {
    const r = v.rate;
    const sweep = Math.min(0.7, d * 0.6);
    const o = osc(v, "sine", 110 * r, t0, d);
    o.frequency.exponentialRampToValueAtTime(32 * r, t0 + sweep);
    const sg = gain(v);
    hit(sg.gain, t0, 1, d / 4);
    chain(v, o, drive(v, 2.2), sg);
    const lp = filter(v, "lowpass", 900 * r, 0.8);
    lp.frequency.exponentialRampToValueAtTime(80 * r, t0 + d);
    const g = gain(v);
    hit(g.gain, t0, 0.9, d / 5);
    chain(v, noise(v, t0, d, "brown"), lp, g);
    // The punch on top.
    const p = gain(v);
    hit(p.gain, t0, 0.5, 0.015);
    chain(v, noise(v, t0, 0.08), filter(v, "lowpass", 3000 * r), p);
  },

  rumble(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    envelope(g.gain, t0, d, 0.9, 0.2, Math.min(0.6, d / 2));
    const wob = gain(v, 0.6);
    wander(v, wob.gain, t0, d, 0.3, 1, 0.12);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 150 * r, 1), wob, g);
    const sub = gain(v);
    envelope(sub.gain, t0, d, 0.22, 0.2, Math.min(0.6, d / 2));
    chain(v, osc(v, "sine", 38 * r, t0, d), drive(v, 1.5), sub);
  },

  impact(v, t0, d) {
    thump(v, t0, 170, 50, 0.12, 0.9, d / 5);
    const g = gain(v);
    hit(g.gain, t0, 0.5, 0.012);
    chain(v, noise(v, t0, 0.1), filter(v, "lowpass", 2500 * v.rate), g);
    const body = gain(v);
    hit(body.gain, t0, 0.4, d / 6);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 400 * v.rate), body);
  },

  crash(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    hit(g.gain, t0, 0.8, d / 6);
    chain(v, noise(v, t0, d, "pink"), filter(v, "bandpass", 1400 * r, 0.6), g);
    const debris = gain(v);
    pops(v, debris.gain, t0 + 0.05, d - 0.05, 30, { peak: [0.2, 0.7], tau: [0.006, 0.03], fade: 0.9 });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2200 * r, 1.5), debris);
    const chunks = gain(v);
    pops(v, chunks.gain, t0 + 0.08, d - 0.08, 9, { peak: [0.3, 0.7], tau: [0.01, 0.04], fade: 0.8 });
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 600 * r), chunks);
    thump(v, t0, 120, 45, 0.1, 0.7, 0.1);
  },

  shatter(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    hit(g.gain, t0, 0.4, d / 6);
    chain(v, noise(v, t0, d), filter(v, "highpass", 5500 * r), g);
    for (let i = 0; i < 20; i++) {
      const at = t0 + Math.pow(v.rand(), 1.8) * d * 0.7;
      const len = 0.04 + v.rand() * 0.1;
      const pg = gain(v);
      hit(pg.gain, at, 0.08 + v.rand() * 0.14, len);
      const f = (2000 + v.rand() * 4500) * r;
      // Two slightly inharmonic partials sound glassier than one sine.
      const o1 = osc(v, "sine", f, at, len * 6);
      const o2 = osc(v, "sine", f * 2.76, at, len * 3);
      const g2 = gain(v, 0.3);
      o1.connect(pg);
      o2.connect(g2).connect(pg);
      pg.connect(v.out);
    }
  },

  ignite(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 200 * r, 1.2);
    lp.frequency.exponentialRampToValueAtTime(2600 * r, t0 + Math.min(0.15, d / 3));
    lp.frequency.exponentialRampToValueAtTime(350 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + Math.min(0.12, d / 3));
    g.gain.setTargetAtTime(0, t0 + Math.min(0.12, d / 3), d / 4);
    chain(v, noise(v, t0, d, "pink"), lp, g);
    thump(v, t0, 80, 45, 0.15, 0.4, 0.1);
    const c = gain(v);
    pops(v, c.gain, t0 + d * 0.3, d * 0.7, 14, { peak: [0.05, 0.2], tau: [0.003, 0.01], fade: 0.8 });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2600 * r, 0.8), c);
  },

  fire(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    envelope(g.gain, t0, d, 1, 0.15, Math.min(0.3, d / 2));
    const roar = gain(v, 0.5);
    wander(v, roar.gain, t0, d, 0.35, 0.8, 0.09);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 800 * r, 0.7), roar, g);
    const breath = gain(v, 0.15);
    wander(v, breath.gain, t0, d, 0.05, 0.18, 0.11);
    chain(v, noise(v, t0, d, "pink"), filter(v, "bandpass", 1500 * r, 0.7), breath, g);
    const embers = gain(v);
    pops(v, embers.gain, t0, d, 16, { peak: [0.08, 0.3], tau: [0.003, 0.01] });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2500 * r, 0.8), embers, g);
  },

  whoosh(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 300 * r, 1.4);
    bp.frequency.exponentialRampToValueAtTime(2200 * r, t0 + d * 0.45);
    bp.frequency.exponentialRampToValueAtTime(500 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(1.4, t0 + d * 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    chain(v, noise(v, t0, d, "pink"), bp, g);
    // Low body so big swings have weight.
    const lo = gain(v);
    lo.gain.setValueAtTime(0.001, t0);
    lo.gain.exponentialRampToValueAtTime(0.6, t0 + d * 0.45);
    lo.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 300 * r), lo);
  },

  wind(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 600 * r, 3.5);
    wander(v, bp.frequency, t0, d, 380 * r, 1100 * r, 0.25);
    const wob = gain(v, 0.6);
    wander(v, wob.gain, t0, d, 0.4, 1, 0.2);
    const g = gain(v);
    envelope(g.gain, t0, d, 1.4, Math.min(0.35, d / 3), Math.min(0.45, d / 3));
    chain(v, noise(v, t0, d, "pink"), bp, wob, g);
    const body = gain(v);
    envelope(body.gain, t0, d, 0.5, Math.min(0.35, d / 3), Math.min(0.45, d / 3));
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 400 * r), body);
  },

  shimmer(v, t0, d) {
    const notes = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637];
    const n = Math.max(3, Math.round(d * 14));
    for (let i = 0; i < n; i++) {
      const at = t0 + (i / n) * d * 0.9 + v.rand() * 0.03;
      const pg = gain(v);
      hit(pg.gain, at, 0.07 + v.rand() * 0.06, 0.18);
      const f = notes[Math.floor(v.rand() * notes.length)] * v.rate;
      osc(v, "sine", f, at, 0.9).connect(pg);
      const over = gain(v, 0.15);
      osc(v, "sine", f * 3.01, at, 0.4).connect(over).connect(pg);
      pg.connect(v.out);
    }
    const air = gain(v);
    envelope(air.gain, t0, d, 0.05, 0.1, 0.3);
    chain(v, noise(v, t0, d), filter(v, "highpass", 7000), air);
  },

  splash(v, t0, d) {
    const r = v.rate;
    const slap = gain(v);
    hit(slap.gain, t0, 0.9, 0.05);
    chain(v, noise(v, t0, 0.3, "pink"), filter(v, "bandpass", 900 * r, 0.9), slap);
    thump(v, t0, 120, 60, 0.08, 0.5, 0.06);
    const spray = gain(v);
    hit(spray.gain, t0 + 0.01, 0.35, d / 4);
    chain(v, noise(v, t0, d), filter(v, "highpass", 3000 * r), spray);
    const n = Math.round(10 + d * 30);
    for (let i = 0; i < n; i++) {
      const at = t0 + 0.03 + Math.pow(v.rand(), 1.4) * (d - 0.05);
      const f = 500 + v.rand() * 900;
      bloop(v, at, f, f * (1.8 + v.rand()), 0.015 + v.rand() * 0.02, 0.05 + v.rand() * 0.12);
    }
  },

  stream(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    envelope(g.gain, t0, d, 1, 0.1, Math.min(0.25, d / 3));
    const rush = gain(v, 0.5);
    wander(v, rush.gain, t0, d, 0.35, 0.75, 0.08);
    chain(v, noise(v, t0, d, "pink"), filter(v, "bandpass", 1200 * r, 0.7), rush, g);
    const churn = gain(v, 0.5);
    wander(v, churn.gain, t0, d, 0.3, 0.7, 0.13);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 320 * r), churn, g);
    const n = Math.round(d * 20);
    for (let i = 0; i < n; i++) {
      const at = t0 + v.rand() * d;
      const f = 300 + v.rand() * 700;
      bloop(v, at, f, f * 2, 0.02 + v.rand() * 0.03, 0.03 + v.rand() * 0.06);
    }
  },

  freeze(v, t0, d) {
    const r = v.rate;
    const c = gain(v);
    pops(v, c.gain, t0, d, 40, { peak: [0.15, 0.7], tau: [0.002, 0.008], rise: 1.5 });
    chain(v, noise(v, t0, d), filter(v, "highpass", 3500 * r), c);
    const whistle = gain(v);
    envelope(whistle.gain, t0, d, 0.08, d * 0.6, Math.min(0.2, d / 3));
    chain(v, noise(v, t0, d), filter(v, "bandpass", 6000 * r, 6), whistle);
    for (let i = 0; i < 2 + Math.floor(v.rand() * 2); i++) {
      const at = t0 + v.rand() * d * 0.7;
      const len = 0.12 + v.rand() * 0.2;
      const o = osc(v, "sawtooth", (150 + v.rand() * 100) * r, at, len);
      o.frequency.linearRampToValueAtTime((130 + v.rand() * 80) * r, at + len);
      const bp = filter(v, "bandpass", 900 * r, 8);
      const gg = gain(v);
      envelope(gg.gain, at, len, 0.12, len * 0.3, len * 0.5);
      chain(v, o, bp, gg);
    }
  },

  squelch(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 250 * r, 6);
    bp.frequency.exponentialRampToValueAtTime(900 * r, t0 + d * 0.35);
    bp.frequency.exponentialRampToValueAtTime(300 * r, t0 + d * 0.8);
    const g = gain(v);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1.6, t0 + 0.02);
    g.gain.setTargetAtTime(0, t0 + d * 0.3, d / 5);
    chain(v, noise(v, t0, d, "pink"), bp, g);
    const low = gain(v);
    hit(low.gain, t0, 0.5, d / 5);
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 250 * r), low);
    for (let i = 0; i < 4; i++) {
      const at = t0 + v.rand() * d * 0.6;
      bloop(v, at, (140 + v.rand() * 60) * r, (260 + v.rand() * 120) * r, 0.04 + v.rand() * 0.04, 0.15 + v.rand() * 0.1);
    }
    const stick = gain(v);
    pops(v, stick.gain, t0 + d * 0.5, d * 0.5, 14, { peak: [0.03, 0.1], tau: [0.002, 0.005] });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 1800 * r, 1.2), stick);
  },

  heartbeat(v, t0, d) {
    const period = 0.7 / v.rate;
    for (let at = t0; at < t0 + d - 0.05; at += period) {
      for (const [dt, peak] of [[0, 0.9], [0.16, 0.6]]) {
        const tb = at + dt;
        if (tb > t0 + d) break;
        thump(v, tb, 80, 40, 0.06, peak, 0.05);
        const n = gain(v);
        hit(n.gain, tb, peak * 0.25, 0.02);
        chain(v, noise(v, tb, 0.1, "brown"), filter(v, "lowpass", 200), n);
      }
    }
  },

  whisper(v, t0, d) {
    const vowels = [[500, 1500, 2500], [700, 1100, 2600], [300, 2200, 3000], [400, 800, 2400], [600, 1700, 2700]];
    const g = gain(v);
    envelope(g.gain, t0, d, 1, Math.min(0.3, d / 3), Math.min(0.4, d / 3));
    const syll = gain(v, 0);
    // Syllable-like swells.
    syll.gain.setValueAtTime(0, t0);
    for (let t = t0; t < t0 + d; ) {
      const len = 0.12 + v.rand() * 0.2;
      syll.gain.setTargetAtTime(0.4 + v.rand() * 0.6, t, 0.03);
      syll.gain.setTargetAtTime(0.05, t + len * 0.7, 0.04);
      t += len + v.rand() * 0.08;
    }
    const sum = gain(v, 1);
    const fs = [0, 1, 2].map((k) => {
      const f = filter(v, "bandpass", vowels[0][k], 8);
      return f;
    });
    for (let t = t0; t < t0 + d; t += 0.15 + v.rand() * 0.15) {
      const vw = vowels[Math.floor(v.rand() * vowels.length)];
      fs.forEach((f, k) => f.frequency.setTargetAtTime(vw[k] * (0.9 + v.rand() * 0.2), t, 0.04));
    }
    const src = noise(v, t0, d, "pink");
    for (const f of fs) src.connect(f).connect(sum);
    chain(v, sum, syll, g);
    const ss = gain(v);
    pops(v, ss.gain, t0, d, 3, { peak: [0.04, 0.1], tau: [0.04, 0.08] });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 7000, 2), ss, g);
  },

  drain(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 200 * r, 3);
    bp.frequency.exponentialRampToValueAtTime(1800 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(1.2, t0 + d * 0.97);
    g.gain.linearRampToValueAtTime(0, t0 + d);
    chain(v, noise(v, t0, d, "pink"), bp, g);
    const lp = filter(v, "lowpass", 500 * r, 2);
    const tg = gain(v);
    tg.gain.setValueAtTime(0.001, t0);
    tg.gain.exponentialRampToValueAtTime(0.25, t0 + d * 0.97);
    tg.gain.linearRampToValueAtTime(0, t0 + d);
    for (const det of [1, 1.013]) {
      const o = osc(v, "sawtooth", 70 * r * det, t0, d);
      o.frequency.exponentialRampToValueAtTime(110 * r * det, t0 + d);
      o.connect(lp);
    }
    chain(v, lp, tg);
    for (let i = 0; i < 4; i++) {
      const at = t0 + (0.3 + v.rand() * 0.6) * d;
      bloop(v, at, 180 * r, 420 * r, 0.05, 0.08);
    }
  },

  drone(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 400 * r, 2);
    wander(v, lp.frequency, t0, d, 200 * r, 700 * r, 0.4);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.22, Math.min(0.5, d / 3), Math.min(0.6, d / 3));
    for (const f of [55, 55.4, 77.8, 110.3]) osc(v, "sawtooth", f * r, t0, d).connect(lp);
    chain(v, lp, drive(v, 1.5), g);
    const bed = gain(v);
    envelope(bed.gain, t0, d, 0.35, Math.min(0.5, d / 3), Math.min(0.6, d / 3));
    chain(v, noise(v, t0, d, "brown"), filter(v, "lowpass", 250 * r), bed);
  },
};

// ------------------------------------------------------------ shared mix bus

// A short, dark stereo room: decaying noise, a little smoothed.
function impulse(ctx, seconds = 1.6) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const r = rng(77 + ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      lp += 0.35 * ((r() * 2 - 1) - lp);
      data[i] = lp * Math.pow(1 - u, 3) * (i < ctx.sampleRate * 0.01 ? i / (ctx.sampleRate * 0.01) : 1);
    }
  }
  return buf;
}

// master gain -> compressor -> destination, plus a reverb send.
function makeBus(ctx, level = MASTER_GAIN) {
  const master = ctx.createGain();
  master.gain.value = level;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  verb.connect(wet).connect(master);
  return { master, verb };
}

// One cue event on a bus. buf: a decoded sample for it, or null for the
// placeholder. Returns the voice's output node and when it ends.
function playVoice(ctx, bus, e, def, { seed = 0, speed = 1, buf = null, t0, pan = true }) {
  const d = Math.max(0.03, (e.kind === "sustained" ? e.dur / Math.max(0.05, speed) : e.dur) / 1000);
  const r = rng(eventSeed(seed, e));
  const out = ctx.createGain();
  out.gain.value = Math.max(0, Math.min(1, e.gain));
  let tail = out;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = (r() * 2 - 1) * 0.25;
    out.connect(p);
    tail = p;
  }
  tail.connect(bus.master);
  const send = ctx.createGain();
  send.gain.value = REVERB_SEND[e.cue] ?? DEFAULT_SEND;
  tail.connect(send).connect(bus.verb);
  const v = { ctx, out, t0, rate: Math.max(0.25, Math.min(4, e.rate || 1)), rand: () => r() };

  let end = t0 + d;
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = v.rate;
    const g = ctx.createGain();
    src.connect(g).connect(out);
    if (e.kind === "sustained") {
      src.loop = buf.duration / v.rate < d;
      envelope(g.gain, t0, d, 1, 0.01, Math.min(0.12, d / 3));
      src.start(t0);
      src.stop(t0 + d);
    } else {
      g.gain.value = 1;
      src.start(t0);
      end = t0 + buf.duration / v.rate;
    }
  } else if (RECIPES[e.cue]) {
    RECIPES[e.cue](v, t0, d);
    end += 0.5; // let decays ring out
  }
  return { out, end: end + 0.8 }; // plus the reverb tail
}

// ------------------------------------------------------------ player

export class SoundPlayer {
  constructor() {
    this.ctx = null;
    this.bus = null;
    this.library = { cues: {} };
    this.muted = false;
    this.voices = new Set();
    this.buffers = new Map(); // url -> AudioBuffer | Promise | null (failed)
    this.base = "sounds/";
  }

  setLibrary(library) {
    this.library = library && library.cues ? library : { cues: {} };
    if (this.ctx) this.preload();
  }

  // Browsers only allow audio after a user gesture, so main.js calls this on
  // the first click or key press.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.bus = makeBus(this.ctx, this.muted ? 0 : MASTER_GAIN);
      this.preload();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.bus) this.bus.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    if (muted) this.stopAll();
  }

  preload() {
    for (const def of Object.values(this.library.cues)) for (const s of def.samples || []) this.buffer(s);
  }

  // Decoded sample, or null while loading or if it failed (the caller falls back).
  buffer(path) {
    const url = this.base + path;
    const have = this.buffers.get(url);
    if (have instanceof AudioBuffer) return have;
    if (have === undefined && this.ctx) {
      const p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => this.buffers.set(url, buf))
        .catch((err) => {
          console.warn(`SpellDirector: could not load sound ${url}, using the placeholder`, err);
          this.buffers.set(url, null);
        });
      this.buffers.set(url, p);
    }
    return null;
  }

  // Play events now. speed is the viewer's playback speed: sustained cues are
  // stretched to stay in sync; one-shots keep their natural length.
  play(events, { seed = 0, speed = 1 } = {}) {
    if (!this.ready || this.muted || !events.length) return;
    for (const e of events) this.start(e, seed, speed);
  }

  start(e, seed, speed) {
    const def = this.library.cues[e.cue];
    if (!def) return; // unknown cue: caption only
    const ctx = this.ctx;
    const samples = def.samples || [];
    const pickR = rng(eventSeed(seed, e) ^ 0x5bd1e995);
    const buf = samples.length ? this.buffer(samples[Math.floor(pickR() * samples.length)]) : null;
    const voice = playVoice(ctx, this.bus, e, def, { seed, speed, buf, t0: ctx.currentTime + 0.005 });
    this.voices.add(voice);
    setTimeout(() => this.release(voice), Math.max(0, (voice.end - ctx.currentTime) * 1000) + 200);
  }

  release(voice) {
    if (!this.voices.delete(voice)) return;
    try {
      voice.out.disconnect();
    } catch {
      /* already gone */
    }
  }

  // Cut everything that's playing (after a jump, a pause or a new spell).
  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      voice.out.gain.cancelScheduledValues(now);
      voice.out.gain.setTargetAtTime(0, now, 0.015);
      setTimeout(() => this.release(voice), 120);
    }
  }
}

// ------------------------------------------------------------ offline render (exports)

export const RENDER_RATE = 44100;

async function loadSamples(ctx, library, base, cueIds) {
  const out = new Map();
  for (const id of cueIds) {
    for (const s of library.cues?.[id]?.samples || []) {
      try {
        const res = await fetch(base + s);
        if (!res.ok) throw new Error(res.status);
        out.set(s, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (err) {
        console.warn(`SpellDirector: could not load sound ${base + s}, using the placeholder`, err);
      }
    }
  }
  return out;
}

// Peak-normalize an AudioBuffer in place to `peakDb` dBFS (default -1).
export function normalize(buf, peakDb = -1) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak < 1e-6) return buf;
  const k = Math.pow(10, peakDb / 20) / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}

// Render events (from soundEvents) offline into a stereo AudioBuffer of
// lengthMs. pan: false keeps every voice centred (single-cue files).
export async function renderEvents(events, library, { seed = 0, lengthMs, base = "sounds/", pan = true, rate = RENDER_RATE } = {}) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) return null;
  const length = Math.max(1, Math.ceil(((lengthMs ?? 1000) / 1000) * rate));
  const ctx = new Offline(2, length, rate);
  const bus = makeBus(ctx, 1);
  const samples = await loadSamples(ctx, library, base, [...new Set(events.map((e) => e.cue))]);
  for (const e of events) {
    const def = library.cues?.[e.cue];
    if (!def) continue;
    const list = (def.samples || []).filter((s) => samples.has(s));
    const pickR = rng(eventSeed(seed, e) ^ 0x5bd1e995);
    const buf = list.length ? samples.get(list[Math.floor(pickR() * list.length)]) : null;
    playVoice(ctx, bus, e, def, { seed, buf, t0: e.at / 1000, pan });
  }
  return ctx.startRendering();
}

// 16-bit PCM WAV bytes for an AudioBuffer.
export function encodeWav(buf) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + n * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return bytes;
}

// The audio files for an export: the whole spell's placeholder mix (a timing
// reference) and one file per cue it uses, each normalized to -1 dBFS.
// sheet: from soundSheet(). Returns [{name, data}] (empty without Web Audio).
export async function renderExportAudio(template, events, sheet, library, { seed = 0, base = "sounds/" } = {}) {
  if (!events.length) return [];
  const files = [];
  const lastEnd = Math.max(...events.map((e) => e.at + e.dur));
  const total = Math.max(template.timing?.duration_ms ?? 0, lastEnd) + 1200;
  const mix = await renderEvents(events, library, { seed, lengthMs: total, base });
  if (!mix) return [];
  files.push({ name: `${template.id}.preview.wav`, data: encodeWav(normalize(mix)) });
  for (const c of sheet.cues) {
    if (!c.known) continue;
    const first = events.find((e) => e.cue === c.cue);
    const len = c.source_ms ?? c.longest_ms;
    const e = { ...first, at: 0, dur: len, gain: 1, rate: 1 };
    const tail = c.kind === "sustained" ? 600 : 900;
    const buf = await renderEvents([e], library, { seed, lengthMs: len + tail, base, pan: false });
    files.push({ name: c.file, data: encodeWav(normalize(buf)) });
  }
  return files;
}
