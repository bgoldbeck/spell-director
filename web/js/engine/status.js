// Status effects (archetype "status"): lingering afflictions on one target
// that apply, loop while they last and expire. The pure parts, shared by the
// viewer (engine/coat.js, engine/glyphs.js, engine/stage.js) and Node tests.

export function isStatus(template) {
  return template?.archetype === "status";
}

// Comic glyphs for sparks with look "glyph" (drawn in engine/glyphs.js).
export const GLYPHS = [
  "z", "star", "question", "exclaim", "heart", "skull", "bubble", "ghost", "swirl", "hourglass", "mute", "drop", "fly", "anger",
];

// Pattern name -> shader index, and whether it is drawn alpha-blended
// (solid-looking skins) rather than added as light.
export const COAT_PATTERNS = {
  glow: { id: 0, alpha: false },
  flame: { id: 1, alpha: false },
  frost: { id: 2, alpha: true },
  stone: { id: 3, alpha: true },
  ooze: { id: 4, alpha: false },
  shadow: { id: 5, alpha: true },
  static: { id: 6, alpha: false },
  ice: { id: 7, alpha: true },
};

export const COAT_SHAPES = ["body", "crystal"];

// The stand-in figure (engine/studio.js): capsule body radius 0.16, straight
// part 0.42, centred at 0.37; head radius 0.13 at 0.86.
export const FIGURE = { bodyR: 0.16, bodyLen: 0.42, bodyY: 0.37, headR: 0.13, headY: 0.86, top: 0.99 };

// Resolved coat params with defaults, in world units where it matters.
// p(name, fallback) reads a param.
export function coatSettings(p, px = 0.01) {
  const pattern = COAT_PATTERNS[p("pattern", "glow")] ? p("pattern", "glow") : "glow";
  const shape = COAT_SHAPES.includes(p("shape", "body")) ? p("shape", "body") : "body";
  return {
    pattern,
    shape,
    inflate: Math.max(0, p("inflate_px", shape === "crystal" ? 0 : 2.5)) * px,
    opacity: Math.max(0, Math.min(1, p("opacity", COAT_PATTERNS[pattern].alpha ? 0.85 : 0.7))),
    rim: Math.max(0, Math.min(1, p("rim", 0.6))),
    fill: Math.max(0, Math.min(1, p("fill", 0.5))),
    scale: Math.max(0.5, p("scale", 6)),
    flowHz: p("flow_hz", pattern === "flame" ? 1 : pattern === "ooze" ? 0.33 : pattern === "shadow" ? 0.5 : 0),
    pulseHz: p("pulse_hz", 0),
    pulse: Math.max(0, Math.min(1, p("pulse", 0.25))),
    coverFrom: p("cover_from_px", 0) * px,
    cover: p("cover_px", 130) * px,
    edge: Math.max(0, Math.min(1, p("edge_glow", 0))),
  };
}
