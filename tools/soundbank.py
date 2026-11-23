"""Build the SpellDirector sound bank: real sound files for every cue.

The viewer's Web Audio placeholders (web/js/audio.js) get timing right but
sound thin. This tool renders each cue in web/sounds/cues.json offline with
numpy, with much richer layering (transient + body + sub + tail, convolution
reverb, saturation, seeded randomness), in three sizes and several takes:

    web/sounds/bank/<cue>/<cue>-<size>-<take>.ogg     size: s, m, l

- small (s): shorter, higher, lighter. A spark, a dagger, a small bolt.
- medium (m): the cue's normal length.
- large (l): longer, deeper, heavier, more sub and room. A big AoE.

Takes differ in their random details (pops, sweeps, pitch), so a cue that
plays several times never repeats exactly. Sustained cues are seamless loops
(except `charge` and `drain`, which swell and cut). Every file is mono,
44.1 kHz, peak-normalized to -1 dBFS, with its transient on the first sample.

Everything here is generated, so the whole bank is our own work and released
as CC0 (see web/sounds/CREDITS.md). It needs numpy and ffmpeg (for Ogg
Vorbis); `--wav` writes WAV files instead.

    python tools/soundbank.py                 # render every cue, update cues.json
    python tools/soundbank.py crack boom      # just these cues
    python tools/soundbank.py --takes 4
    python tools/soundbank.py import clang path/to/hit.wav --source URL --author NAME --license CC0
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import wave
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOUNDS = ROOT / "web" / "sounds"
CUES_PATH = SOUNDS / "cues.json"
BANK = SOUNDS / "bank"
CREDITS = SOUNDS / "CREDITS.md"

SR = 44100
SIZES = {"s": "small", "m": "medium", "l": "large"}
# Length and pitch per size. Large sounds are longer and lower; small ones
# shorter and higher (bigger means lower, longer and with more sub).
SIZE_SCALE = {"s": (0.65, 1.18), "m": (1.0, 1.0), "l": (1.6, 0.84)}
# Sustained cues that swell and cut instead of looping.
SHAPED = {"charge", "drain"}
# Loop lengths (s) per size for the other sustained cues.
LOOP_S = {"s": 2.0, "m": 3.0, "l": 4.0}
# Loops render this much longer than the loop, and the overhang is crossfaded in.
LOOP_PAD = 1.4
DEFAULT_TAKES = 3
ALLOWED_LICENSES = {"CC0", "CC-BY", "public domain"}

# ------------------------------------------------------------ DSP helpers


def n_of(seconds: float) -> int:
    return max(1, int(round(seconds * SR)))


def times(n: int) -> np.ndarray:
    return np.arange(n) / SR


def unit_rms(x: np.ndarray) -> np.ndarray:
    r = np.sqrt(np.mean(x * x))
    return x / r if r > 1e-12 else x


def noise(rng, n: int, color: str = "white") -> np.ndarray:
    """White, pink (1/f) or brown (1/f^2) noise at unit RMS."""
    w = rng.standard_normal(n)
    if color == "white" or n < 4:
        return unit_rms(w)
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    f = np.maximum(f, 20.0)
    spec /= np.sqrt(f) if color == "pink" else f
    return unit_rms(np.fft.irfft(spec, n))


# Frequency responses (magnitudes) as functions of a frequency array.
def bp(f, fc, octaves=1.0):
    """Band-pass bump, `octaves` wide (standard deviation in octaves)."""
    return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / octaves) ** 2)


def lp(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (np.maximum(f, 0.0) / fc) ** (2 * order))


def hp(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1.0)) ** (2 * order))


def filt(x: np.ndarray, response) -> np.ndarray:
    """Static filter: response(f) -> gain, applied in the frequency domain."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x) * response(f), n)


def shape(x: np.ndarray, response, frame: int = 1024, hop: int = 256) -> np.ndarray:
    """Time-varying filter by STFT: response(t, f) -> gain, t in seconds
    (column vector) and f in Hz (row vector). Sweeps, wandering resonances."""
    n = len(x)
    win = np.sqrt(np.hanning(frame + 1)[:frame])
    pad = np.concatenate([np.zeros(frame), x, np.zeros(frame)])
    starts = np.arange(0, len(pad) - frame + 1, hop)
    frames = np.stack([pad[s:s + frame] for s in starts]) * win
    spec = np.fft.rfft(frames, axis=1)
    t = ((starts + frame / 2 - frame) / SR)[:, None]
    f = np.fft.rfftfreq(frame, 1 / SR)[None, :]
    g = np.broadcast_to(response(t, f), spec.shape)
    out_frames = np.fft.irfft(spec * g, frame, axis=1) * win
    out = np.zeros(len(pad))
    wsum = np.zeros(len(pad))
    for i, s in enumerate(starts):
        out[s:s + frame] += out_frames[i]
        wsum[s:s + frame] += win * win
    out = out / np.maximum(wsum, 1e-6)
    return out[frame:frame + n]


def glide(n: int, start: float, end: float, curve: float = 1.0) -> np.ndarray:
    """Exponential frequency glide from start to end; curve > 1 holds the
    start longer, < 1 moves early."""
    u = np.linspace(0, 1, n) ** curve
    return start * (end / start) ** u


def phase(freq) -> np.ndarray:
    return 2 * np.pi * np.cumsum(freq) / SR


def sine(freq, n: int, ph0: float = 0.0) -> np.ndarray:
    freq = np.broadcast_to(np.asarray(freq, float), (n,))
    return np.sin(phase(freq) + ph0)


def saw(freq, n: int, max_harmonics: int = 48) -> np.ndarray:
    """Band-limited saw by additive synthesis."""
    freq = np.broadcast_to(np.asarray(freq, float), (n,))
    ph = phase(freq)
    k_max = int(min(max_harmonics, (SR / 2) / max(freq.max(), 1.0)))
    out = np.zeros(n)
    for k in range(1, max(1, k_max) + 1):
        out += np.sin(k * ph) / k
    return out * 0.6


def env_ad(n: int, attack: float, tau: float) -> np.ndarray:
    """Linear attack, exponential decay (time constant tau seconds)."""
    t = times(n)
    a = max(attack, 1.0 / SR)
    return np.where(t < a, t / a, np.exp(-(t - a) / max(tau, 1e-4)))


def env_hold(n: int, attack: float, release: float) -> np.ndarray:
    t = times(n)
    d = n / SR
    e = np.ones(n)
    if attack > 0:
        e = np.minimum(e, t / attack)
    if release > 0:
        e = np.minimum(e, (d - t) / release)
    return np.clip(e, 0, 1)


def wander(rng, n: int, rate_hz: float, lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    """Smooth random curve between lo and hi, changing about rate_hz times a second."""
    pts = max(3, int(n / SR * rate_hz) + 3)
    vals = rng.uniform(lo, hi, pts)
    x = np.linspace(0, pts - 1, n)
    i = np.minimum(np.floor(x).astype(int), pts - 2)
    u = x - i
    u = u * u * (3 - 2 * u)  # smoothstep between points
    return vals[i] * (1 - u) + vals[i + 1] * u


def loop_wander(rng, n: int, cycles: int, lo: float = 0.0, hi: float = 1.0) -> np.ndarray:
    """Like wander, but the curve ends where it starts (for loops)."""
    t = np.linspace(0, 1, n, endpoint=False)
    out = np.zeros(n)
    for k in range(1, 4):
        out += rng.uniform(0.3, 1) / k * np.sin(2 * np.pi * (cycles * k) * t + rng.uniform(0, 2 * np.pi))
    out = (out - out.min()) / max(out.max() - out.min(), 1e-9)
    return lo + (hi - lo) * out


def pops(rng, n: int, per_second: float, *, tau=(0.002, 0.012), amp=(0.3, 1.0), band=(1500, 6000),
         density=None, tone: float = 0.0) -> np.ndarray:
    """Random short clicks: crackle, embers, debris, ice. density(t in 0-1)
    scales the rate over time; tone > 0 mixes in a ringing sine per pop
    (glassy pings, bubbles)."""
    d = n / SR
    out = np.zeros(n)
    count = rng.poisson(max(per_second * d, 1))
    if density is not None:
        u = rng.uniform(0, 1, count * 3)
        keep = rng.uniform(0, 1, len(u)) < np.clip(density(u), 0, 1)
        at = u[keep][:max(count, 1)]
    else:
        at = rng.uniform(0, 1, count)
    for u in at:
        i = int(u * n)
        tt = rng.uniform(*tau)
        m = min(n - i, int(tt * 6 * SR) + 8)
        if m <= 4:
            continue
        t = times(m)
        e = np.exp(-t / tt) * rng.uniform(*amp)
        fc = np.exp(rng.uniform(np.log(band[0]), np.log(band[1])))
        click = rng.standard_normal(m)
        # Cheap one-pole-ish coloring: mix a sine at fc into the click.
        ring = np.sin(2 * np.pi * fc * t + rng.uniform(0, 6.28))
        out[i:i + m] += e * ((1 - tone) * (0.5 * click + 0.5 * ring) + tone * ring)
    return out


def chirps(rng, n: int, per_second: float, *, f=(600, 2400), rise=(1.3, 2.2), tau=(0.004, 0.02),
           amp=(0.3, 1.0), density=None) -> np.ndarray:
    """Bubble blips: short sines that rise in pitch (water, ooze)."""
    d = n / SR
    out = np.zeros(n)
    count = rng.poisson(max(per_second * d, 1))
    for _ in range(count):
        u = rng.uniform()
        if density is not None and rng.uniform() > density(u):
            continue
        i = int(u * n)
        tt = rng.uniform(*tau)
        m = min(n - i, int(tt * 5 * SR) + 8)
        if m <= 4:
            continue
        f0 = np.exp(rng.uniform(np.log(f[0]), np.log(f[1])))
        fr = glide(m, f0, f0 * rng.uniform(*rise), 0.6)
        out[i:i + m] += sine(fr, m) * env_ad(m, 0.001, tt) * rng.uniform(*amp)
    return out


def metal(rng, n: int, f0: float, *, tau: float = 0.6, ratios=(1.0, 2.76, 5.40, 8.93, 13.34), bright: float = 1.0):
    """Inharmonic ringing partials: blades, bells, struck metal."""
    out = np.zeros(n)
    for k, r in enumerate(ratios):
        fr = f0 * r * rng.uniform(0.985, 1.015)
        if fr > SR * 0.45:
            continue
        beat = 1 + 0.004 * np.sin(2 * np.pi * rng.uniform(1, 5) * times(n))
        a = (0.8 ** k) * (bright if k else 1.0)
        out += a * sine(fr * beat, n, rng.uniform(0, 6.28)) * env_ad(n, 0.0005, tau / (1 + 0.6 * k))
    return out


def saturate(x: np.ndarray, drive: float = 2.0) -> np.ndarray:
    peak = np.max(np.abs(x)) or 1.0
    return np.tanh(drive * x / peak) / np.tanh(drive) * peak


def reverb(x: np.ndarray, rng, seconds: float = 1.2, mix: float = 0.25, damp: float = 4000.0, pre_ms: float = 8) -> np.ndarray:
    """Convolution with a synthetic room: decaying noise that gets darker."""
    if mix <= 0:
        return x
    x = fade_out(x, min(0.08, len(x) / SR / 4))  # no cut where the dry part ends
    m = n_of(seconds)
    ir = rng.standard_normal(m) * np.exp(-times(m) * 6.9 / seconds)
    ir = shape(ir, lambda t, f: lp(f, damp * np.exp(-2.2 * np.maximum(t, 0) / seconds) + 300, 1))
    ir = np.concatenate([np.zeros(n_of(pre_ms / 1000)), ir])
    ir /= np.sqrt(np.sum(ir * ir)) or 1.0
    size = len(x) + len(ir)
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)
    dry = np.concatenate([x, np.zeros(len(ir))])
    rd = np.sqrt(np.mean(x * x)) or 1.0
    rw = np.sqrt(np.mean(wet[:len(x)] ** 2)) or 1.0
    return dry + mix * wet * (rd / rw)


def fade_out(x: np.ndarray, seconds: float) -> np.ndarray:
    m = min(len(x), n_of(seconds))
    x = x.copy()
    x[-m:] *= np.linspace(1, 0, m) ** 2
    return x


def trim_lead(x: np.ndarray, threshold_db: float = -45) -> np.ndarray:
    """Cut silence before the first sample above threshold, so the
    transient lands on the event's frame."""
    peak = np.max(np.abs(x)) or 1.0
    idx = np.flatnonzero(np.abs(x) > peak * 10 ** (threshold_db / 20))
    return x[max(0, idx[0] - 4):] if len(idx) else x


def trim_tail(x: np.ndarray, threshold_db: float = -60, keep_ms: float = 30) -> np.ndarray:
    peak = np.max(np.abs(x)) or 1.0
    idx = np.flatnonzero(np.abs(x) > peak * 10 ** (threshold_db / 20))
    if not len(idx):
        return x
    end = min(len(x), idx[-1] + n_of(keep_ms / 1000))
    return fade_out(x[:end], min(0.05, end / SR / 4))


def make_loop(x: np.ndarray, loop_n: int) -> np.ndarray:
    """Seamless loop of loop_n samples from x (which must be longer): the
    overhang is crossfaded into the start (equal power)."""
    xf = min(len(x) - loop_n, loop_n // 3)
    y = x[:loop_n].copy()
    r = np.linspace(0, 1, xf)
    y[:xf] = x[:xf] * np.sqrt(r) + x[loop_n:loop_n + xf] * np.sqrt(1 - r)
    return y


def normalize(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    x = x - np.mean(x)
    peak = np.max(np.abs(x)) or 1.0
    return x * (10 ** (peak_db / 20) / peak)


def mix(*parts) -> np.ndarray:
    """Sum (signal, gain) pairs, padding to the longest."""
    n = max(len(p) for p, _ in parts)
    out = np.zeros(n)
    for p, g in parts:
        out[:len(p)] += g * p
    return out


# ------------------------------------------------------------ cue recipes
#
# recipe(rng, d, k) -> mono float array. d: target length in seconds (a loop
# gets a little extra to crossfade); k: pitch scale for the size (1 = medium,
# < 1 bigger and lower). Each recipe follows the cue's `character` in
# cues.json: transient, body, sub, tail.

RECIPES = {}


def recipe(fn):
    RECIPES[fn.__name__.rstrip("_")] = fn
    return fn


@recipe
def charge(rng, d, k):
    n = n_of(d)
    t = np.linspace(0, 1, n)
    f = glide(n, 90 * k * rng.uniform(0.9, 1.1), 520 * k * rng.uniform(0.9, 1.15), 1.6)
    tone = saw(f, n, 24) * 0.5 + saw(f * 1.006, n, 24) * 0.5 + 0.6 * sine(f * 2, n)
    tone = shape(tone, lambda tt, ff: lp(ff, 400 + 5000 * np.clip(tt / d, 0, 1) ** 1.5, 2))
    trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(phase(glide(n, 6, 28, 1.0))))
    air = shape(noise(rng, n, "pink"), lambda tt, ff: bp(ff, 300 + 6000 * np.clip(tt / d, 0, 1) ** 2, 0.5))
    crackle = pops(rng, n, 90, density=lambda u: u ** 1.5, band=(2500, 9000), amp=(0.2, 0.8))
    swell = t ** 2.2
    out = mix((tone * trem, 0.8), (air, 0.45), (crackle, 0.35)) * swell
    out[-n_of(0.004):] *= np.linspace(1, 0, n_of(0.004))  # hard cut into the release
    return out


@recipe
def hum(rng, d, k):
    n = n_of(d)
    f0 = 82 * k * rng.uniform(0.94, 1.06)
    body = sum(a * sine(f0 * h * (1 + rng.uniform(-0.003, 0.003)), n, rng.uniform(0, 6)) for h, a in ((1, 1), (2, 0.55), (3, 0.3), (4, 0.18), (6, 0.08)))
    beat = sine(f0 * 1.007, n) * 0.6
    air = filt(noise(rng, n, "pink"), lambda f: bp(f, 320 * k, 0.6)) * 0.12
    wob = 1 + 0.12 * np.sin(2 * np.pi * rng.uniform(0.4, 1.1) * times(n))
    return saturate((body + beat) * wob + air, 1.6)


@recipe
def buzz(rng, d, k):
    n = n_of(d)
    f0 = 98 * k * rng.uniform(0.92, 1.08)
    tone = saturate(saw(f0 * (1 + 0.01 * wander(rng, n, 6, -1, 1)), n, 80), 4.0)
    tone = filt(tone, lambda f: hp(f, 180) * (0.4 + bp(f, 1800 * k, 1.0)))
    flicker = np.repeat(rng.uniform(0.35, 1.0, n // 700 + 2), 700)[:n]
    flicker = filt(flicker, lambda f: lp(f, 90, 1))
    hiss = filt(noise(rng, n), lambda f: bp(f, 5000, 0.7)) * 0.25
    zaps = pops(rng, n, 25, band=(2000, 7000), amp=(0.3, 1))
    return tone * flicker + hiss * flicker + zaps * 0.5


@recipe
def crackle(rng, d, k):
    n = n_of(d)
    p = pops(rng, n, 140, tau=(0.0008, 0.006), band=(1500 / k, 9000), amp=(0.1, 1.0))
    big = pops(rng, n, 14, tau=(0.003, 0.015), band=(700, 3000), amp=(0.6, 1.2))
    hiss = filt(noise(rng, n), lambda f: hp(f, 3500)) * 0.06
    return p + big + hiss


@recipe
def sizzle(rng, d, k):
    n = n_of(d)
    s = filt(noise(rng, n), lambda f: hp(f, 3800 * k, 3) * lp(f, 13000))
    am = 0.35 + 0.65 * np.abs(filt(rng.standard_normal(n), lambda f: lp(f, 60, 1))) * 3
    spit = pops(rng, n, 50, tau=(0.0006, 0.003), band=(5000, 11000))
    return s * np.clip(am, 0, 1.4) + 0.6 * spit


@recipe
def zap(rng, d, k):
    n = n_of(d)
    f = glide(n, 3200 * k * rng.uniform(0.85, 1.15), 160 * k, 0.45)
    tone = saturate(saw(f, n, 16) + 0.5 * sine(f * 1.5, n), 2.5) * env_ad(n, 0.001, d * 0.35)
    snap = filt(noise(rng, n), lambda ff: hp(ff, 2500)) * env_ad(n, 0.0005, 0.008)
    fizz = filt(noise(rng, n), lambda ff: bp(ff, 6000, 0.6)) * env_ad(n, 0.002, d * 0.25)
    return reverb(mix((tone, 0.7), (snap, 1.0), (fizz, 0.25)), rng, 0.6, 0.18)


@recipe
def crack(rng, d, k):
    n = n_of(d)
    snap = noise(rng, n) * env_ad(n, 0.0003, 0.006)
    # Thunder-crack body: several sub-cracks in the first 120 ms, jagged.
    body = np.zeros(n)
    for _ in range(rng.integers(3, 7)):
        i = int(rng.uniform(0, min(0.12, d * 0.3)) * SR)
        m = n - i
        body[i:] += noise(rng, m) * env_ad(m, 0.0005, rng.uniform(0.02, 0.07)) * rng.uniform(0.4, 1.0)
    body = filt(body, lambda f: hp(f, 400 * k) * lp(f, 9000))
    tail = filt(noise(rng, n, "brown"), lambda f: lp(f, 500 * k)) * env_ad(n, 0.01, d * 0.4)
    thump = sine(glide(n, 110 * k, 45 * k), n) * env_ad(n, 0.001, 0.08)
    dry = mix((snap, 1.0), (body, 0.8), (tail, 0.5), (thump, 0.6))
    return reverb(saturate(dry, 1.5), rng, 1.4 / k, 0.35)


@recipe
def boom(rng, d, k):
    n = n_of(d)
    sub = sine(glide(n, 75 * k, 32 * k, 0.5), n) * env_ad(n, 0.004, d * 0.35)
    knock = sine(glide(n, 180 * k, 70 * k, 0.4), n) * env_ad(n, 0.001, 0.06)
    click = filt(noise(rng, n), lambda f: hp(f, 1500)) * env_ad(n, 0.0003, 0.004)
    body = filt(noise(rng, n, "brown"), lambda f: lp(f, 700 * k)) * env_ad(n, 0.003, d * 0.28)
    debris = filt(pops(rng, n, 30, density=lambda u: np.exp(-4 * u), band=(400, 2500), tau=(0.004, 0.02)), lambda f: lp(f, 3000))
    dry = saturate(mix((sub, 1.0), (knock, 0.5), (click, 0.5), (body, 0.7), (debris, 0.15)), 2.2)
    return reverb(dry, rng, 1.8 / k, 0.3, damp=2500)


@recipe
def rumble(rng, d, k):
    n = n_of(d)
    base = filt(noise(rng, n, "brown"), lambda f: lp(f, 240 * k, 2) * hp(f, 25))
    swell = loop_wander(rng, n, max(1, int(d * 1.5)), 0.45, 1.0)
    grit = filt(noise(rng, n, "pink"), lambda f: bp(f, 600 * k, 0.7)) * 0.12
    thuds = filt(pops(rng, n, 4, tau=(0.03, 0.08), band=(50, 120), tone=0.8), lambda f: lp(f, 200))
    return saturate(base * swell + grit * swell + thuds * 0.8, 1.4)


@recipe
def impact(rng, d, k):
    n = n_of(d)
    click = noise(rng, n) * env_ad(n, 0.0003, 0.004)
    body = filt(noise(rng, n, "pink"), lambda f: bp(f, 420 * k * rng.uniform(0.8, 1.25), 0.9)) * env_ad(n, 0.001, 0.05)
    thud = sine(glide(n, 120 * k, 52 * k, 0.4), n) * env_ad(n, 0.001, 0.09)
    dry = saturate(mix((click, 0.6), (body, 1.0), (thud, 1.1)), 2.0)
    return reverb(dry, rng, 0.7, 0.12)


@recipe
def crash(rng, d, k):
    n = n_of(d)
    hit_ = noise(rng, n) * env_ad(n, 0.0005, 0.03)
    roar = filt(noise(rng, n, "pink"), lambda f: hp(f, 120) * lp(f, 6000)) * env_ad(n, 0.002, d * 0.22)
    chunks = pops(rng, n, 70, tau=(0.006, 0.03), band=(250, 3500), amp=(0.3, 1.0), density=lambda u: np.exp(-2.5 * u))
    pebbles = pops(rng, n, 120, tau=(0.001, 0.005), band=(2500, 8000), amp=(0.1, 0.5), density=lambda u: np.exp(-1.5 * u))
    thud = sine(glide(n, 95 * k, 40 * k), n) * env_ad(n, 0.002, 0.15)
    dry = saturate(mix((hit_, 0.8), (roar, 0.7), (chunks, 0.8), (pebbles, 0.35), (thud, 0.9)), 1.8)
    return reverb(dry, rng, 1.3 / k, 0.25)


@recipe
def shatter(rng, d, k):
    n = n_of(d)
    snap = filt(noise(rng, n), lambda f: hp(f, 1800)) * env_ad(n, 0.0003, 0.012)
    burst = filt(noise(rng, n), lambda f: hp(f, 3000)) * env_ad(n, 0.001, 0.09)
    pings = np.zeros(n)
    for _ in range(rng.integers(18, 34)):
        u = rng.uniform(0, 1) ** 2.2 * 0.8
        i = int(u * n)
        m = n - i
        f0 = rng.uniform(2200, 6500) / k
        pings[i:] += metal(rng, m, f0, tau=rng.uniform(0.04, 0.2), ratios=(1.0, 2.32, 4.25), bright=0.6) * rng.uniform(0.15, 0.6) * (1 - u)
    tinkle = pops(rng, n, 80, tau=(0.001, 0.004), band=(4000, 11000), density=lambda u: np.exp(-3 * u))
    return reverb(mix((snap, 1.0), (burst, 0.5), (pings, 0.6), (tinkle, 0.3)), rng, 1.0, 0.3, damp=7000)


@recipe
def ignite(rng, d, k):
    n = n_of(d)
    t = times(n)
    whump = shape(noise(rng, n, "pink"), lambda tt, f: lp(f, 180 + 2800 * np.clip(tt / (d * 0.35), 0, 1) ** 1.3, 2))
    env = np.clip(t / 0.06, 0, 1) ** 1.5 * np.exp(-np.maximum(t - 0.06, 0) / (d * 0.35))
    low = sine(glide(n, 60 * k, 95 * k, 0.5), n) * env * 0.8
    embers = pops(rng, n, 60, tau=(0.001, 0.006), band=(1500, 6000), density=lambda u: np.clip(u * 3, 0, 1) * np.exp(-2 * u))
    return reverb(saturate(mix((whump * env, 1.0), (low, 0.6), (embers, 0.3)), 1.6), rng, 0.9, 0.18)


@recipe
def fire(rng, d, k):
    n = n_of(d)
    roar = filt(noise(rng, n, "brown"), lambda f: lp(f, 700 * k) * hp(f, 40))
    flutter = loop_wander(rng, n, max(2, int(d * 3)), 0.5, 1.0)
    breath = filt(noise(rng, n, "pink"), lambda f: bp(f, 1200 * k, 0.8)) * loop_wander(rng, n, max(2, int(d * 2)), 0.1, 0.5)
    embers = pops(rng, n, 35, tau=(0.001, 0.008), band=(1200, 7000), amp=(0.2, 1.0))
    snaps = pops(rng, n, 4, tau=(0.004, 0.015), band=(600, 2500), amp=(0.8, 1.3))
    return saturate(roar * flutter + breath + 0.45 * embers + 0.6 * snaps, 1.3)


@recipe
def whoosh(rng, d, k):
    n = n_of(d)
    peak = rng.uniform(0.38, 0.5)
    u = np.linspace(0, 1, n)
    env = np.where(u < peak, (u / peak) ** 2.2, ((1 - u) / (1 - peak)) ** 1.6)
    f_lo, f_hi = 350 * k, 2600 * k * rng.uniform(0.85, 1.2)

    def resp(tt, f):
        x = np.clip(tt / d, 0, 1)
        fc = f_lo + (f_hi - f_lo) * np.exp(-((x - peak) / 0.22) ** 2)
        return bp(f, fc, 0.75) + 0.25 * bp(f, fc * 2.3, 0.4)

    air = shape(noise(rng, n, "pink"), resp)
    return reverb(air * env, rng, 0.5, 0.12)


@recipe
def wind(rng, d, k):
    n = n_of(d)
    cycles = max(1, int(d / 1.2))
    fc = loop_wander(rng, n, cycles, 380 * k, 1300 * k)
    gust = loop_wander(rng, n, cycles + 1, 0.35, 1.0)
    f_t = lambda tt: np.interp(np.clip(tt, 0, d), times(n), fc)  # noqa: E731
    howl = shape(noise(rng, n, "pink"), lambda tt, f: bp(f, f_t(tt), 0.28) + 0.3 * bp(f, f_t(tt) * 2.1, 0.2))
    bed = filt(noise(rng, n, "pink"), lambda f: lp(f, 900 * k) * hp(f, 80)) * 0.5
    return (howl + bed) * gust


@recipe
def shimmer(rng, d, k):
    n = n_of(d)
    scale = np.array([0, 2, 4, 7, 9, 12, 14, 16, 19])  # major pentatonic, consonant
    root = 880 * rng.choice([1, 1.122, 1.335]) / k
    out = np.zeros(n)
    for _ in range(int(14 * d) + 6):
        i = int(rng.uniform(0, 1) * n)
        m = n - i
        f = root * 2 ** (rng.choice(scale) / 12)
        tau = rng.uniform(0.15, 0.6)
        tone = sine(f, m) + 0.25 * sine(f * 2.01, m) + 0.12 * sine(f * 3.98, m)
        out[i:] += tone * env_ad(m, rng.uniform(0.005, 0.04), tau) * rng.uniform(0.2, 0.6)
    air = filt(noise(rng, n), lambda f: bp(f, 7000, 0.5)) * 0.06 * (0.7 + 0.3 * loop_wander(rng, n, 2))
    pad = sum(sine(root * 2 ** (s / 12) / 2 * (1 + rng.uniform(-0.002, 0.002)), n) for s in (0, 4, 7)) * 0.06
    return out + air + pad


@recipe
def splash(rng, d, k):
    n = n_of(d)
    slap = filt(noise(rng, n), lambda f: bp(f, 1600 * k, 1.2)) * env_ad(n, 0.0005, 0.03)
    body = shape(noise(rng, n, "pink"), lambda tt, f: bp(f, 1800 * k * np.exp(-np.clip(tt, 0, None) * 2.5) + 300, 0.9)) * env_ad(n, 0.003, d * 0.25)
    plop = sine(glide(n, 220 * k, 520 * k, 0.6), n) * env_ad(n, 0.001, 0.05)
    drops = chirps(rng, n, 50, f=(900 / k, 3000 / k), tau=(0.004, 0.015), density=lambda u: np.clip(u * 4, 0, 1) * np.exp(-2 * u))
    patter = pops(rng, n, 80, tau=(0.001, 0.004), band=(2000, 7000), amp=(0.1, 0.5), density=lambda u: np.clip(u * 3, 0, 1) * np.exp(-2.5 * u))
    return reverb(mix((slap, 0.9), (body, 0.9), (plop, 0.5), (drops, 0.4), (patter, 0.3)), rng, 0.7, 0.15)


@recipe
def stream(rng, d, k):
    n = n_of(d)
    bed = filt(noise(rng, n, "pink"), lambda f: bp(f, 900 * k, 1.1)) * (0.7 + 0.3 * loop_wander(rng, n, 3))
    bubbles = chirps(rng, n, 160, f=(500 / k, 2400 / k), tau=(0.003, 0.012), amp=(0.1, 0.6))
    gurgle = chirps(rng, n, 12, f=(200 / k, 600 / k), tau=(0.01, 0.04), amp=(0.4, 0.9))
    return bed * 0.6 + bubbles + gurgle * 0.6


@recipe
def freeze(rng, d, k):
    n = n_of(d)
    grow = lambda u: 0.15 + 0.85 * u  # noqa: E731 - ice spreads, so denser later
    crackle_ = pops(rng, n, 160, tau=(0.0006, 0.003), band=(3000, 10000), density=grow, amp=(0.1, 0.8))
    creak = pops(rng, n, 18, tau=(0.006, 0.02), band=(900, 2500), density=grow, tone=0.5)
    pings = np.zeros(n)
    for _ in range(int(10 * d) + 3):
        i = int(rng.uniform(0, 1) * n)
        pings[i:] += metal(rng, n - i, rng.uniform(2500, 5500) / k, tau=rng.uniform(0.05, 0.15), ratios=(1.0, 2.41, 4.6), bright=0.5) * 0.25
    frost = filt(noise(rng, n), lambda f: hp(f, 6000)) * 0.05 * np.linspace(0.4, 1, n)
    return crackle_ + creak * 0.6 + pings + frost


@recipe
def squelch(rng, d, k):
    n = n_of(d)
    slap = filt(noise(rng, n, "pink"), lambda f: lp(f, 1200 * k)) * env_ad(n, 0.001, 0.04)
    goo = shape(noise(rng, n, "brown"), lambda tt, f: bp(f, 900 * k * np.exp(-np.clip(tt, 0, None) * 6) + 160 * k, 0.35)) * env_ad(n, 0.004, d * 0.3)
    blub = chirps(rng, n, 30, f=(180 / k, 650 / k), rise=(1.4, 2.6), tau=(0.01, 0.03), density=lambda u: np.exp(-4 * u)) * env_ad(n, 0.002, d * 0.4)
    thick = sine(glide(n, 140 * k, 70 * k), n) * env_ad(n, 0.002, 0.06)
    return saturate(mix((slap, 0.8), (goo, 1.0), (blub, 0.5), (thick, 0.5)), 1.8)


@recipe
def heartbeat(rng, d, k):
    n = n_of(d)
    out = np.zeros(n)
    # Whole beats per loop, so the loop is seamless (d includes LOOP_PAD).
    loop = d / LOOP_PAD
    beats = max(1, int(round(loop / (0.8 / k ** 0.5))))
    period = loop / beats
    beats = int(np.ceil(d / period))
    for b in range(beats):
        for off, a in ((0.0, 1.0), (0.22, 0.7)):  # lub, dub
            i = int((b * period + off) * SR)
            if i >= n:
                continue
            m = min(n - i, n_of(0.35))
            thump = sine(glide(m, 70 * k, 38 * k, 0.5), m) * env_ad(m, 0.006, 0.08)
            out[i:i + m] += a * thump
    body = filt(out, lambda f: lp(f, 300))
    return saturate(body, 2.0)


@recipe
def whisper(rng, d, k):
    n = n_of(d)
    syl = wander(rng, n, 5.5, 0, 1) ** 2  # syllable-like swells
    formants = [(loop_wander(rng, n, max(1, int(d * 2)), lo, hi)) for lo, hi in ((450, 800), (1100, 1900), (2400, 3300))]
    f_at = [lambda tt, c=c: np.interp(np.clip(tt, 0, d), times(n), c) for c in formants]
    breath = shape(noise(rng, n), lambda tt, f: sum(g * bp(f, fa(tt) / k ** 0.3, 0.18) for g, fa in zip((1, 0.7, 0.4), f_at)) + 0.15 * hp(f, 5000))
    # A second voice a little behind, for an uneasy chorus.
    other = np.roll(breath, n // 3) * np.roll(syl, n // 5) * 0.6
    return breath * syl + other


@recipe
def drain(rng, d, k):
    n = n_of(d)
    u = np.linspace(0, 1, n)
    swell = u ** 2.5  # reversed envelope: quiet to loud with a hard stop
    suck = shape(noise(rng, n, "pink"), lambda tt, f: bp(f, 2400 * k * np.exp(-1.6 * np.clip(tt / d, 0, 1)), 0.6) * (1 - 0.7 * bp(f, 1000, 0.3)))
    tone = sine(glide(n, 220 * k, 110 * k), n) + 0.6 * sine(glide(n, 311 * k, 155 * k), n)  # tritone, hollow
    out = mix((suck, 1.0), (tone, 0.35)) * swell
    out[-n_of(0.004):] *= np.linspace(1, 0, n_of(0.004))
    return out


@recipe
def drone(rng, d, k):
    n = n_of(d)
    f0 = 55 * k * rng.uniform(0.94, 1.06)
    voices = sum(saw(f0 * r * (1 + rng.uniform(-0.004, 0.004)), n, 30) for r in (1, 1.004, 1.414, 2.0))
    dark = filt(voices, lambda f: lp(f, 650 * k, 2))
    breathe = loop_wander(rng, n, max(1, int(d / 1.5)), 0.6, 1.0)
    sub = sine(f0 / 2, n) * 0.5
    air = filt(noise(rng, n, "brown"), lambda f: bp(f, 250, 0.8)) * 0.2
    return saturate(dark * breathe + sub + air, 1.5)


@recipe
def swing(rng, d, k):
    """A blade cutting air: thin, fast, high whistle that peaks early."""
    n = n_of(d)
    peak = rng.uniform(0.28, 0.4)
    u = np.linspace(0, 1, n)
    env = np.where(u < peak, (u / peak) ** 1.8, ((1 - u) / (1 - peak)) ** 2.4)
    f_lo, f_hi = 900 * k, 4200 * k * rng.uniform(0.85, 1.15)

    def resp(tt, f):
        x = np.clip(tt / d, 0, 1)
        fc = f_lo + (f_hi - f_lo) * np.exp(-((x - peak) / 0.16) ** 2)
        return bp(f, fc, 0.3) + 0.35 * bp(f, fc * 0.5, 0.5)

    air = shape(noise(rng, n), resp)
    ring = metal(rng, n, rng.uniform(1900, 2600) / k, tau=0.08, ratios=(1.0, 2.71), bright=0.4) * env * 0.08
    return reverb(air * env + ring, rng, 0.4, 0.08)


@recipe
def clang(rng, d, k):
    """Metal on metal: a sharp strike and a long inharmonic ring."""
    n = n_of(d)
    strike = filt(noise(rng, n), lambda f: hp(f, 1500)) * env_ad(n, 0.0002, 0.006)
    f0 = rng.uniform(380, 620) * k
    ring = metal(rng, n, f0, tau=d * 0.35, ratios=(1.0, 2.76, 5.40, 8.93, 13.34, 1.51), bright=0.9)
    clank = filt(noise(rng, n, "pink"), lambda f: bp(f, 1400 * k, 0.6)) * env_ad(n, 0.0005, 0.03)
    return reverb(mix((strike, 0.9), (ring, 0.7), (clank, 0.6)), rng, 0.9, 0.2, damp=6000)


# ------------------------------------------------------------ rendering


def take_seed(cue: str, size: str, take: int) -> int:
    return zlib.crc32(f"{cue}:{size}:{take}".encode())


def render(cue: str, kind: str, base_ms: float, size: str, take: int) -> np.ndarray:
    """One bank file as a float array (mono, SR, -1 dBFS peak)."""
    rng = np.random.default_rng(take_seed(cue, size, take))
    scale, k = SIZE_SCALE[size]
    fn = RECIPES[cue]
    if kind == "sustained" and cue not in SHAPED:
        loop_n = n_of(LOOP_S[size])
        x = fn(rng, LOOP_S[size] * LOOP_PAD, k)
        return normalize(make_loop(x, loop_n))
    d = base_ms / 1000 * scale
    x = fn(rng, d, k)
    if cue in SHAPED:
        return normalize(x)  # swell and cut: keep the exact length
    x = trim_tail(trim_lead(x))
    return normalize(fade_out(x, min(0.03, len(x) / SR / 5)))


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def write_ogg(path: Path, x: np.ndarray, quality: int = 4) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg not found: install it, or pass --wav")
    tmp = path.with_suffix(".tmp.wav")
    write_wav(tmp, x)
    try:
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(tmp), "-c:a", "libvorbis", "-q:a", str(quality),
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(path)], check=True)
    finally:
        tmp.unlink(missing_ok=True)


def load_cues() -> dict:
    return json.loads(CUES_PATH.read_text(encoding="utf-8"))


def save_cues(doc: dict) -> None:
    CUES_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build(cue_ids: list[str], takes: int, ext: str) -> None:
    doc = load_cues()
    cues = doc["cues"]
    for cue in cue_ids:
        if cue not in cues:
            raise SystemExit(f"unknown cue {cue!r}")
        if cue not in RECIPES:
            raise SystemExit(f"no bank recipe for {cue!r}: add one to tools/soundbank.py")
    for cue in cue_ids:
        c = cues[cue]
        out_dir = BANK / cue
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob(f"{cue}-*"):
            old.unlink()
        entries = []
        for size in SIZES:
            for take in range(1, takes + 1):
                x = render(cue, c["kind"], c["duration_ms"], size, take)
                name = f"{cue}-{size}-{take}.{ext}"
                (write_ogg if ext == "ogg" else write_wav)(out_dir / name, x)
                entries.append({"file": f"bank/{cue}/{name}", "size": SIZES[size], "duration_ms": round(len(x) / SR * 1000)})
        # Keep hand-added samples (recordings) alongside the generated ones.
        kept = [s for s in c.get("samples", []) if not str(s.get("file", s) if isinstance(s, dict) else s).startswith("bank/")]
        c["samples"] = kept + entries
        print(f"{cue}: {len(entries)} files")
    save_cues(doc)


# ------------------------------------------------------------ importing recordings


def read_audio(path: Path) -> np.ndarray:
    """Any audio file to mono float at SR (via ffmpeg unless it's a WAV)."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        raw = subprocess.run([ffmpeg, "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             check=True, capture_output=True).stdout
        return np.frombuffer(raw, dtype="<f4").astype(float)
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != SR or w.getsampwidth() != 2:
            raise SystemExit("without ffmpeg only 44.1 kHz 16-bit WAV files can be imported")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768
        return x.reshape(-1, w.getnchannels()).mean(axis=1)


def import_files(cue: str, files: list[Path], size: str, source: str, author: str, license_: str) -> None:
    if license_ not in ALLOWED_LICENSES:
        raise SystemExit(f"license {license_!r} is not allowed: use one of {sorted(ALLOWED_LICENSES)} (see web/sounds/README.md)")
    doc = load_cues()
    if cue not in doc["cues"]:
        raise SystemExit(f"unknown cue {cue!r}")
    c = doc["cues"][cue]
    out_dir = SOUNDS / "samples"
    out_dir.mkdir(exist_ok=True)
    rows = []
    for src in files:
        x = read_audio(src)
        if c["kind"] == "one_shot":
            x = trim_tail(trim_lead(x))
        x = normalize(x)
        n = 1
        while (out_dir / f"{cue}-{n}.ogg").exists():
            n += 1
        name = f"{cue}-{n}.ogg"
        write_ogg(out_dir / name, x)
        c.setdefault("samples", []).append({"file": f"samples/{name}", "size": size, "duration_ms": round(len(x) / SR * 1000)})
        rows.append(f"| `samples/{name}` | `{cue}` | {source} | {author} | {license_} |")
        print(f"added samples/{name}")
    save_cues(doc)
    text = CREDITS.read_text(encoding="utf-8")
    marker = "<!-- recordings -->"
    text = text.replace(marker, marker + "\n" + "\n".join(rows)) if marker in text else text.rstrip() + "\n" + "\n".join(rows) + "\n"
    CREDITS.write_text(text, encoding="utf-8")


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["import"]:
        ap = argparse.ArgumentParser(prog="soundbank.py import", description="Add CC0 / CC-BY recordings to a cue")
        ap.add_argument("cue")
        ap.add_argument("files", nargs="+", type=Path)
        ap.add_argument("--size", choices=list(SIZES.values()), default="medium")
        ap.add_argument("--source", required=True, help="URL the file came from")
        ap.add_argument("--author", required=True)
        ap.add_argument("--license", required=True, dest="license_", help=f"one of {sorted(ALLOWED_LICENSES)}")
        a = ap.parse_args(argv[1:])
        import_files(a.cue, a.files, a.size, a.source, a.author, a.license_)
        return 0
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cues", nargs="*", help="cue ids (default: all)")
    ap.add_argument("--takes", type=int, default=DEFAULT_TAKES)
    ap.add_argument("--wav", action="store_true", help="write WAV instead of Ogg Vorbis")
    a = ap.parse_args(argv)
    ids = a.cues or list(load_cues()["cues"])
    build(ids, a.takes, "wav" if a.wav else "ogg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
