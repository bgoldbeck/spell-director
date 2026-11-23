// The animation clips the viewer knows (format "spelldirector.clip/1", see
// engine/rig.js): Mixamo animations converted by web/js/clipimport.js, or
// clips SpellDirector baked itself. A template plays one on the caster with
// space.caster_clip; the page loads clips before it builds a spell, so the
// stage can stay synchronous (and a pure function of template, seed, time).

import { isClip } from "./rig.js";

const clips = new Map();

/** Make a clip available under a name (a file name without .json). */
export function registerClip(name, clip) {
  if (!name || !isClip(clip)) return false;
  clips.set(String(name), clip);
  return true;
}

/** The clip with this name, or null. */
export function getClip(name) {
  return (name && clips.get(String(name))) || null;
}

export function clipNames() {
  return [...clips.keys()].sort();
}

/** Clip names a template asks for (space.caster_clip.clip). */
export function clipsWanted(template) {
  const c = template?.space?.caster_clip?.clip;
  return c ? [String(c)] : [];
}
