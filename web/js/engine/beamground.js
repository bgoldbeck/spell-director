// Keeping a beam out of the ground. Pure: no Three.js, so Node can test it,
// and small enough to port line for line (Unity: run it on the beam's points
// before building the ribbon).

/**
 * Tilt a path up from its first point so that every point sits at least
 * reach(u) + clear above the ground (y = 0), u being 0 at the first point and
 * 1 at the last. Raises each point by lift * u (a straight tilt, no bend) and
 * returns lift (world units at the far end; 0 when it already clears).
 */
export function groundLift(pts, reach, clear) {
  const n = pts.length - 1;
  if (n < 1) return 0;
  let lift = 0;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    lift = Math.max(lift, (reach(u) + clear - pts[i].y) / Math.max(u, 0.05));
  }
  if (lift > 0) for (let i = 1; i <= n; i++) pts[i].y += (lift * i) / n;
  return lift;
}
