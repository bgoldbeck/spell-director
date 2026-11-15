import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cuesAt, eventsBetween, soundEvents } from "../web/js/engine/sound.js";

const library = JSON.parse(readFileSync(new URL("../web/sounds/cues.json", import.meta.url), "utf8"));

const template = {
  beats: [
    { id: "charge", start_ms: 0, end_ms: 400 },
    { id: "strike", start_ms: 400, end_ms: 460 },
    { id: "hit", start_ms: 460, end_ms: 800 },
    { id: "fade", start_ms: 700, end_ms: 1200 },
  ],
  layers: [
    { id: "bolt", type: "bolt", beats: ["strike"] },
    { id: "build", type: "sound_cue", beats: ["charge"], params: { cue: "charge" } },
    { id: "snap", type: "sound_cue", beats: ["strike", "hit"], params: { cue: "crack", pitch: { min: 0.8, max: 1.2 } } },
    { id: "tail", type: "sound_cue", beats: ["hit", "fade"], params: { cue: "rumble", gain: 0.4, offset_ms: 50 } },
    { id: "hops", type: "sound_cue", beats: ["hit"], params: { cue: "zap", repeat_ms: 100 } },
    { id: "odd", type: "sound_cue", beats: ["fade"], params: { cue: "kazoo" } },
  ],
};

test("one-shots fire at each beat start, sustained cues span the layer's beats", () => {
  const ev = soundEvents(template, 1, library);
  const by = (id) => ev.filter((e) => e.layer === id);
  assert.deepEqual(by("build").map((e) => [e.at, e.dur, e.kind]), [[0, 400, "sustained"]]);
  assert.deepEqual(by("snap").map((e) => e.at), [400, 460]);
  assert.equal(by("snap")[0].dur, library.cues.crack.duration_ms);
  assert.deepEqual(by("tail").map((e) => [e.at, e.dur, e.gain]), [[510, 690, 0.4]]);
  assert.deepEqual(by("hops").map((e) => e.at), [460, 560, 660, 760]);
  assert.equal(by("bolt").length, 0);
  const odd = by("odd")[0];
  assert.equal(odd.known, false);
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].at <= e.at), "sorted by start");
});

test("schedule is a pure function of template and seed", () => {
  assert.deepEqual(soundEvents(template, 7, library), soundEvents(template, 7, library));
  const rates = (seed) => soundEvents(template, seed, library).filter((e) => e.layer === "snap").map((e) => e.rate);
  for (const r of rates(7)) assert.ok(r >= 0.8 && r <= 1.2);
  assert.notDeepEqual(rates(7), rates(8));
  assert.notEqual(rates(7)[0], rates(7)[1], "each hit varies");
});

test("eventsBetween is half-open, so frames never play a cue twice", () => {
  const ev = soundEvents(template, 1, library);
  const frames = [0, 16, 400, 416, 460, 900, 1200];
  const played = [];
  for (let i = 0; i < frames.length - 1; i++) played.push(...eventsBetween(ev, frames[i], frames[i + 1]));
  assert.equal(played.length, ev.length);
});

test("captions follow the schedule", () => {
  const ev = soundEvents(template, 1, library);
  assert.deepEqual(cuesAt(ev, 100), ["charge"]);
  assert.ok(cuesAt(ev, 405).includes("crack"));
  assert.ok(cuesAt(ev, 1000).includes("rumble"));
  assert.deepEqual(cuesAt(ev, 1250), []);
});

test("every bundled sound cue uses a cue from the library", () => {
  const index = JSON.parse(readFileSync(new URL("../templates/index.json", import.meta.url), "utf8"));
  for (const p of index.templates) {
    const tpl = JSON.parse(readFileSync(new URL(`../templates/${p}`, import.meta.url), "utf8"));
    for (const e of soundEvents(tpl, 1, library)) assert.ok(e.known, `${tpl.id}: ${e.cue}`);
  }
});
