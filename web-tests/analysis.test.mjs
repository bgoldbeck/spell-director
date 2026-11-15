import assert from "node:assert/strict";
import test from "node:test";
import {
  clipDuration, compactBreakdown, cutTimes, directorPrompt, frameAt, phaseAt, phaseBands, playTime, savedFiles,
  slug, spaceFacts, timingFacts, viewScores, warnings,
} from "../web/js/analysis.js";

const frames = [0, 40, 80, 160, 200].map((start_ms, index, all) => ({
  index, start_ms, duration_ms: (all[index + 1] ?? 260) - start_ms, intensity: index / 4, coverage: 0.1, motion: 0.01,
  phase_hint: "none", shot: index < 3 ? 0 : 1,
}));
const B = {
  gif: { source: "Big Bolt.mp4", width: 320, height: 180, frame_count: 5, duration_ms: 260, video: { fps: 25, max_fps: 30, start_s: 1.5, truncated: true } },
  bright_background: true, background_luma: 0.5,
  shots: [{ shot: 0, start_frame: 0, end_frame: 2, start_ms: 0, end_ms: 160 }, { shot: 1, start_frame: 3, end_frame: 4, start_ms: 160, end_ms: 260 }],
  main_shot: 1,
  timing: { phases: [{ phase: "anticipation", start_frame: 0, end_frame: 1, start_ms: 0, end_ms: 40 }, { phase: "impact", start_frame: 3, end_frame: 4, start_ms: 160, end_ms: 200 }],
    peaks: [{ frame: 4, ms: 200, intensity: 1 }], main_peak_ms: 200, main_peak_frame: 4 },
  space: { footprint_bbox: [0.25, 0.1, 0.75, 0.9], footprint_aspect: 0.6, travel_direction: "stationary", shot: 1,
    view_guess: { best: "side", confidence: 0.6, scores: { front: 1, side: 2, top: 0, three_quarter: 0.5 } } },
  palette: [{ hex: "#FFFFFF", suggested_slot: "core", share: 0.2 }],
  frames,
  images: { contact_sheet: "contact_sheet.png", curves: "curves.png", palette: "palette.png", heatmap: "heatmap.png", player_frames: ["frames/0000.jpg"] },
};

test("frameAt finds the frame showing at a time, clamped to the clip", () => {
  assert.equal(frameAt(frames, -5), 0);
  assert.equal(frameAt(frames, 39), 0);
  assert.equal(frameAt(frames, 40), 1);
  assert.equal(frameAt(frames, 159), 2);
  assert.equal(frameAt(frames, 9999), 4);
  assert.equal(frameAt([], 10), -1);
  assert.equal(clipDuration(B), 260);
});

test("playTime loops or holds on the last moment", () => {
  assert.equal(playTime(300, 260, true), 40);
  assert.equal(playTime(300, 260, false), 259);
  assert.equal(playTime(10, 0, true), 0);
});

test("phase bands cover their whole frames and phaseAt reads them", () => {
  const bands = phaseBands(B);
  assert.deepEqual(bands.map((b) => [b.phase, b.start_ms, b.end_ms]), [["anticipation", 0, 80], ["impact", 160, 260]]);
  assert.equal(phaseAt(bands, 50).phase, "anticipation");
  assert.equal(phaseAt(bands, 100), null);
  assert.deepEqual(cutTimes(B), [160]);
});

test("warnings, facts and view scores describe the breakdown", () => {
  const w = warnings(B).join(" ");
  assert.match(w, /first 20 seconds/);
  assert.match(w, /Bright background/);
  assert.match(w, /2 camera shots.*shot 2/);
  const space = Object.fromEntries(spaceFacts(B));
  assert.equal(space["View guess"], "Side (confidence 0.6)");
  assert.equal(space.Footprint, "50% wide × 80% tall of the frame");
  assert.equal(space["Measured in"], "shot 2");
  assert.match(Object.fromEntries(timingFacts(B)).Video, /from 1.5 s/);
  const scores = viewScores(B);
  assert.deepEqual(scores.map((s) => s.view), ["side", "front", "three_quarter", "top"]);
  assert.equal(scores[0].best, true);
  assert.equal(scores[1].fraction, 0.5);
});

test("saved files, slug and the director prompt", () => {
  assert.deepEqual(savedFiles(B), ["breakdown.json", "contact_sheet.png", "curves.png", "palette.png", "heatmap.png"]);
  assert.equal(slug("Big Bolt (final).mp4"), "big-bolt-final");
  assert.equal(slug(""), "clip");
  const c = compactBreakdown(B);
  assert.equal(c.images, undefined);
  assert.deepEqual(c.frames[3], [3, 160, 40, 0.75, 0.1, 0.01, "none", 1]);
  const prompt = directorPrompt(B, "SUMMARY LINE");
  assert.match(prompt, /Big Bolt\.mp4/);
  assert.match(prompt, /director-playbook\.md/);
  assert.match(prompt, /SUMMARY LINE/);
  const json = prompt.slice(prompt.indexOf("```json\n") + 8, prompt.lastIndexOf("\n```"));
  assert.equal(JSON.parse(json).gif.source, "Big Bolt.mp4");
});
