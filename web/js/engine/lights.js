// Where a light layer hangs. Pure (no Three.js) so the Node tests share it.

// A point light. By default it hangs 80 px above its anchor; `forward_px`
// (along the cast direction), `side_px` (positive = left of it) and
// `height_px` (negative = below the ground) place it anywhere around the
// anchor: a key, rim or under light. `orbit_hz` swings it round the anchor
// at that distance, and `tint` (#rrggbb) colors it outside the palette.
export function lightOffset(p, t) {
  const fwd = p.forward ?? 0;
  const side = p.side ?? 0;
  const turn = (p.orbit_hz ?? 0) * (t / 1000) * Math.PI * 2;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  // Cast direction is +X, its left is -Z; the orbit turns counter-clockwise seen from above.
  return [fwd * c - side * s, p.height ?? 80, -(fwd * s + side * c)];
}
