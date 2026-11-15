// Plays sound cue events (see engine/sound.js) with Web Audio.
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

// ------------------------------------------------------------ building blocks

let noiseBuf = null;
function noiseBuffer(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  const r = rng(1234);
  for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
  return noiseBuf;
}

function noise(v, t0, d) {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
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
  f.frequency.setValueAtTime(freq, v.ctx.currentTime);
  f.Q.value = q;
  return f;
}

function gain(v, value = 0) {
  const g = v.ctx.createGain();
  g.gain.value = value;
  return g;
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
function pops(v, param, t0, d, perSecond, { peak = [0.3, 1], tau = [0.004, 0.02], fade = 0 } = {}) {
  param.setValueAtTime(0, t0);
  const n = Math.max(1, Math.round(d * perSecond));
  const times = Array.from({ length: n }, () => t0 + v.rand() * d).sort((a, b) => a - b);
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

// ------------------------------------------------------------ placeholder recipes
// Each gets a voice v = {ctx, out, rate, rand} and plays from t0 for d seconds.

export const RECIPES = {
  charge(v, t0, d) {
    const r = v.rate;
    const o = osc(v, "sawtooth", 110 * r, t0, d);
    o.frequency.exponentialRampToValueAtTime(440 * r, t0 + d);
    const lp = filter(v, "lowpass", 300 * r, 4);
    lp.frequency.exponentialRampToValueAtTime(3200 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + d * 0.95);
    g.gain.linearRampToValueAtTime(0, t0 + d);
    chain(v, o, lp, g);
    const n = noise(v, t0, d);
    const bp = filter(v, "bandpass", 800 * r, 2);
    bp.frequency.exponentialRampToValueAtTime(5000 * r, t0 + d);
    const ng = gain(v);
    ng.gain.setValueAtTime(0.001, t0);
    ng.gain.exponentialRampToValueAtTime(0.25, t0 + d * 0.95);
    ng.gain.linearRampToValueAtTime(0, t0 + d);
    chain(v, n, bp, ng);
  },

  hum(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 420 * r, 1);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.25, 0.08, 0.15);
    const trem = gain(v, 1);
    const lfo = osc(v, "sine", 6, t0, d);
    const depth = gain(v, 0.25);
    lfo.connect(depth).connect(trem.gain);
    for (const [type, f] of [["sawtooth", 55], ["sawtooth", 55.6], ["sine", 110]]) osc(v, type, f * r, t0, d).connect(lp);
    chain(v, lp, trem, g);
  },

  buzz(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 1300 * r, 1.2);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.5, 0.02, 0.06);
    const jitter = gain(v, 0.7);
    const lfo = osc(v, "square", 33, t0, d);
    const depth = gain(v, 0.3);
    lfo.connect(depth).connect(jitter.gain);
    osc(v, "square", 100 * r, t0, d).connect(bp);
    osc(v, "sawtooth", 150.5 * r, t0, d).connect(bp);
    chain(v, bp, jitter, g);
  },

  crackle(v, t0, d) {
    const hp = filter(v, "highpass", 2200 * v.rate, 0.7);
    const g = gain(v);
    pops(v, g.gain, t0, d, 38, { peak: [0.2, 0.9], tau: [0.003, 0.012] });
    chain(v, noise(v, t0, d), hp, g);
  },

  sizzle(v, t0, d) {
    const hp = filter(v, "highpass", 4500 * v.rate, 0.8);
    const g = gain(v);
    envelope(g.gain, t0, d, 0.3, 0.03, 0.12);
    const flutter = gain(v, 0.6);
    const lfo = osc(v, "sine", 17, t0, d);
    const depth = gain(v, 0.4);
    lfo.connect(depth).connect(flutter.gain);
    chain(v, noise(v, t0, d), hp, flutter, g);
  },

  zap(v, t0, d) {
    const r = v.rate;
    const o = osc(v, "sawtooth", 1800 * r, t0, d);
    o.frequency.exponentialRampToValueAtTime(140 * r, t0 + d);
    const g = gain(v);
    hit(g.gain, t0, 0.3, d / 3);
    chain(v, o, filter(v, "lowpass", 5000 * r, 1), g);
    const ng = gain(v);
    hit(ng.gain, t0, 0.35, 0.012);
    chain(v, noise(v, t0, 0.08), filter(v, "highpass", 3000 * r), ng);
  },

  crack(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    hit(g.gain, t0, 1, 0.04);
    chain(v, noise(v, t0, d), filter(v, "highpass", 700 * r), g);
    const ring = gain(v);
    hit(ring.gain, t0, 0.5, d / 4);
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2400 * r, 1.5), ring);
    thump(v, t0, 140, 60, 0.08, 0.5, 0.06);
  },

  boom(v, t0, d) {
    const r = v.rate;
    thump(v, t0, 110, 32, Math.min(0.7, d * 0.6), 0.9, d / 4);
    const lp = filter(v, "lowpass", 500 * r, 0.8);
    lp.frequency.exponentialRampToValueAtTime(90 * r, t0 + d);
    const g = gain(v);
    hit(g.gain, t0, 0.8, d / 5);
    chain(v, noise(v, t0, d), lp, g);
  },

  rumble(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    envelope(g.gain, t0, d, 0.7, 0.2, Math.min(0.6, d / 2));
    const wob = gain(v, 0.6);
    wander(v, wob.gain, t0, d, 0.35, 1, 0.12);
    chain(v, noise(v, t0, d), filter(v, "lowpass", 130 * r, 1), wob, g);
    const sub = gain(v);
    envelope(sub.gain, t0, d, 0.25, 0.2, Math.min(0.6, d / 2));
    chain(v, osc(v, "sine", 38 * r, t0, d), sub);
  },

  impact(v, t0, d) {
    thump(v, t0, 170, 50, 0.12, 0.9, d / 5);
    const g = gain(v);
    hit(g.gain, t0, 0.5, 0.012);
    chain(v, noise(v, t0, 0.1), filter(v, "lowpass", 2500 * v.rate), g);
  },

  crash(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    hit(g.gain, t0, 0.8, d / 6);
    chain(v, noise(v, t0, d), filter(v, "bandpass", 1400 * r, 0.6), g);
    const debris = gain(v);
    pops(v, debris.gain, t0 + 0.05, d - 0.05, 30, { peak: [0.2, 0.7], tau: [0.006, 0.03], fade: 0.9 });
    chain(v, noise(v, t0, d), filter(v, "bandpass", 2200 * r, 1.5), debris);
    thump(v, t0, 120, 45, 0.1, 0.7, 0.1);
  },

  shatter(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    hit(g.gain, t0, 0.4, d / 6);
    chain(v, noise(v, t0, d), filter(v, "highpass", 5500 * r), g);
    for (let i = 0; i < 18; i++) {
      const at = t0 + Math.pow(v.rand(), 1.8) * d * 0.7;
      const len = 0.04 + v.rand() * 0.1;
      const pg = gain(v);
      hit(pg.gain, at, 0.08 + v.rand() * 0.14, len);
      chain(v, osc(v, "sine", (2000 + v.rand() * 4500) * r, at, len * 6), pg);
    }
  },

  ignite(v, t0, d) {
    const r = v.rate;
    const lp = filter(v, "lowpass", 200 * r, 1.2);
    lp.frequency.exponentialRampToValueAtTime(2600 * r, t0 + Math.min(0.15, d / 3));
    lp.frequency.exponentialRampToValueAtTime(350 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.8, t0 + Math.min(0.12, d / 3));
    g.gain.setTargetAtTime(0, t0 + Math.min(0.12, d / 3), d / 4);
    chain(v, noise(v, t0, d), lp, g);
    thump(v, t0, 80, 45, 0.15, 0.4, 0.1);
  },

  fire(v, t0, d) {
    const r = v.rate;
    const g = gain(v);
    envelope(g.gain, t0, d, 0.9, 0.15, Math.min(0.3, d / 2));
    const roar = gain(v, 0.5);
    wander(v, roar.gain, t0, d, 0.3, 0.6, 0.1);
    chain(v, noise(v, t0, d), filter(v, "lowpass", 700 * r, 0.7), roar, g);
    const embers = gain(v);
    pops(v, embers.gain, t0, d, 14, { peak: [0.2, 0.6], tau: [0.004, 0.015] });
    chain(v, noise(v, t0, d), filter(v, "highpass", 1600 * r), embers, g);
  },

  whoosh(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 300 * r, 1.8);
    bp.frequency.exponentialRampToValueAtTime(2200 * r, t0 + d * 0.45);
    bp.frequency.exponentialRampToValueAtTime(500 * r, t0 + d);
    const g = gain(v);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(1.6, t0 + d * 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    chain(v, noise(v, t0, d), bp, g);
  },

  wind(v, t0, d) {
    const r = v.rate;
    const bp = filter(v, "bandpass", 600 * r, 3.5);
    wander(v, bp.frequency, t0, d, 380 * r, 1100 * r, 0.25);
    const wob = gain(v, 0.6);
    wander(v, wob.gain, t0, d, 0.4, 1, 0.2);
    const g = gain(v);
    envelope(g.gain, t0, d, 1.5, Math.min(0.35, d / 3), Math.min(0.45, d / 3));
    chain(v, noise(v, t0, d), bp, wob, g);
  },

  shimmer(v, t0, d) {
    const notes = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637];
    const n = Math.max(3, Math.round(d * 14));
    for (let i = 0; i < n; i++) {
      const at = t0 + (i / n) * d * 0.9 + v.rand() * 0.03;
      const pg = gain(v);
      hit(pg.gain, at, 0.07 + v.rand() * 0.06, 0.15);
      chain(v, osc(v, "sine", notes[Math.floor(v.rand() * notes.length)] * v.rate, at, 0.9), pg);
    }
    const air = gain(v);
    envelope(air.gain, t0, d, 0.06, 0.1, 0.3);
    chain(v, noise(v, t0, d), filter(v, "highpass", 7000), air);
  },
};

// ------------------------------------------------------------ player

export class SoundPlayer {
  constructor() {
    this.ctx = null;
    this.master = null;
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
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(comp).connect(this.ctx.destination);
      this.preload();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
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
    const t0 = ctx.currentTime + 0.005;
    const d = Math.max(0.03, (e.kind === "sustained" ? e.dur / Math.max(0.05, speed) : e.dur) / 1000);
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, e.gain));
    out.connect(this.master);
    const r = rng(eventSeed(seed, e));
    const v = { ctx, out, rate: Math.max(0.25, Math.min(4, e.rate || 1)), rand: () => r() };

    const samples = def.samples || [];
    const buf = samples.length ? this.buffer(samples[Math.floor(r() * samples.length)]) : null;
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
    const voice = { out, end };
    this.voices.add(voice);
    setTimeout(() => this.release(voice), Math.max(0, (end - ctx.currentTime) * 1000) + 200);
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
