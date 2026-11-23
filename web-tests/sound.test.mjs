import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cuePrompt, cuesAt, eventSize, eventsBetween, pickSample, sampleEntries, soundEvents, soundFileName, soundSheet, SOUND_SHEET_FORMAT } from "../web/js/engine/sound.js";

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

test("sound sheet: events carry beat, role, file and volume; cues carry prompts and recipes", () => {
  const tpl = { id: "t", name: "T", element: "water", timing: { duration_ms: 1200 }, ...template };
  tpl.beats = template.beats.map((b, i) => ({ ...b, phase: ["anticipation", "release", "impact", "dissipation"][i] }));
  const sheet = soundSheet(tpl, 1, library, { frameOf: (ms) => Math.floor(ms / 33.3) });
  assert.equal(sheet.format, SOUND_SHEET_FORMAT);
  assert.equal(sheet.events.length, soundEvents(tpl, 1, library).length);
  const snap = sheet.events.filter((e) => e.layer === "snap");
  assert.deepEqual(snap.map((e) => [e.beat, e.role]), [["strike", "launch"], ["hit", "hit"]]);
  assert.equal(snap[0].file, soundFileName("crack"));
  assert.equal(snap[0].frame, Math.floor(400 / 33.3));
  const tail = sheet.events.find((e) => e.layer === "tail");
  assert.equal(tail.volume_db, -8);
  assert.equal(tail.end_ms, 1200);
  assert.equal(sheet.events.find((e) => e.cue === "kazoo").file, null);
  const crack = sheet.cues.find((c) => c.cue === "crack");
  assert.equal(crack.plays, 2);
  assert.ok(crack.prompt.includes(library.cues.crack.sfx_prompt) && crack.prompt.includes(`Water spell: ${library.flavors.water.words}`));
  assert.ok(crack.synth && crack.search.length && crack.character.envelope);
  assert.equal(crack.generate.loop, false);
  const rumble = sheet.cues.find((c) => c.cue === "rumble");
  assert.equal(rumble.generate.loop, false, "short sustained cues are made at full length");
  const long = soundSheet({ ...tpl, layers: [{ id: "w", type: "sound_cue", beats: ["charge", "fade"], params: { cue: "wind", pitch: 1.5 } }] }, 1, library);
  assert.equal(long.cues[0].source_ms, 1800, "pitch 1.5 needs 1.5x the source");
  assert.deepEqual([long.cues[0].generate.loop, long.cues[0].generate.duration_s], [false, 1.8]);
  const longer = soundSheet({ ...tpl, layers: [{ id: "w", type: "sound_cue", beats: ["charge", "fade"], params: { cue: "wind", duration_ms: 6000 } }] }, 1, library);
  assert.deepEqual([longer.cues[0].generate.loop, longer.cues[0].generate.duration_s], [true, 4]);
  assert.equal(sheet.cues.find((c) => c.cue === "kazoo").known, false);
  assert.ok(sheet.story.some((x) => x.includes("strike") && x.includes("crack")));
  assert.deepEqual(soundSheet(tpl, 1, library), soundSheet(tpl, 1, library), "pure");
});

test("prompts add the element's flavor and keep out what it should avoid", () => {
  const p = cuePrompt(library.cues.drain, library.flavors.dark, "dark");
  assert.ok(p.startsWith(library.cues.drain.sfx_prompt));
  assert.ok(p.includes("Dark spell: hollow") && p.includes("No screams"));
  assert.equal(cuePrompt(library.cues.zap, null), library.cues.zap.sfx_prompt);
  assert.ok(cuePrompt(library.cues.drain, library.flavors.dark, "dark").startsWith(library.cues.drain.sfx_prompt + ". Dark spell:"));
});

test("every cue has the sound-design fields", () => {
  for (const [id, c] of Object.entries(library.cues)) {
    for (const k of ["texture", "pitch", "envelope", "layers", "tail", "space"]) assert.ok(c.character?.[k], `${id}.character.${k}`);
    assert.ok(c.synth && c.search?.length, id);
  }
});

test("every cue has a sound bank in three sizes", () => {
  for (const [id, def] of Object.entries(library.cues)) {
    const sizes = new Set(sampleEntries(def).map((s) => s.size));
    assert.deepEqual([...sizes].sort(), ["large", "medium", "small"], id);
  }
  assert.deepEqual(sampleEntries({ samples: ["samples/x-1.ogg"] }), [{ file: "samples/x-1.ogg", size: null, duration_ms: null }]);
});

test("pickSample: the layer's size, a take from the seed, repeats vary", () => {
  const tpl = {
    beats: [{ id: "a", start_ms: 0, end_ms: 1000 }],
    layers: [
      { id: "big", type: "sound_cue", beats: ["a"], params: { cue: "boom", size: "large" } },
      { id: "hops", type: "sound_cue", beats: ["a"], params: { cue: "zap", repeat_ms: 100 } },
    ],
  };
  const ev = soundEvents(tpl, 3, library);
  const big = ev.find((e) => e.layer === "big");
  assert.equal(pickSample(library.cues.boom, big, 3).size, "large");
  assert.deepEqual(pickSample(library.cues.boom, big, 3), pickSample(library.cues.boom, big, 3));
  const hops = ev.filter((e) => e.layer === "hops").map((e) => pickSample(library.cues.zap, e, 3));
  assert.ok(hops.every((s) => s.size === "medium"));
  assert.ok(new Set(hops.map((s) => s.file)).size > 1, "repeats use different takes");
  assert.equal(pickSample({ samples: [] }, big, 3), null);
});

test("eventSize fits the length for build-ups and one-shots with a set duration", () => {
  const charge = library.cues.charge;
  const at = (dur) => eventSize(charge, { cue: "charge", kind: "sustained", dur, rate: 1 });
  assert.equal(at(500), "small");
  assert.equal(at(800), "medium");
  assert.equal(at(1400), "large");
  const crack = library.cues.crack;
  assert.equal(eventSize(crack, { cue: "crack", kind: "one_shot", dur: 450, rate: 1 }), "medium");
  assert.equal(eventSize(crack, { cue: "crack", kind: "one_shot", dur: 2000, rate: 1, fit: true }), "large");
});

test("the sound sheet names the bank file each event plays", () => {
  const sheet = soundSheet(template, 1, library);
  const known = sheet.events.filter((e) => e.cue !== "kazoo");
  assert.ok(known.every((e) => /^sounds\/[a-z]+-[sml]-\d+\.ogg$/.test(e.sample)), JSON.stringify(known.map((e) => e.sample)));
  assert.equal(sheet.events.find((e) => e.cue === "kazoo").sample, null);
  const crack = sheet.cues.find((c) => c.cue === "crack");
  assert.ok(crack.samples_used.length >= 1);
});
