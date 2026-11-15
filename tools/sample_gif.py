"""Draw a small synthetic sky-strike GIF with a known timeline.

Used by the tests and handy for trying the breakdown tool without a real GIF:
    python tools/sample_gif.py samples/synthetic-sky-strike.gif
    python tools/breakdown.py samples/synthetic-sky-strike.gif

Timeline (40 ms frames, 28 frames, 1120 ms):
    0-1    empty
    2-9    anticipation: ground glow grows
    10-11  release: bolt at full brightness (hold 2 frames)
    12     dim
    13     restrike
    14     dim
    15     restrike
    16-27  dissipation: afterglow and ring fade out
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 240, 200
FRAME_MS = 40
GROUND = (120, 160)
BG = (14, 16, 26)

# Frame -> bolt brightness (0 = no bolt)
BOLT = {10: 1.0, 11: 1.0, 12: 0.35, 13: 0.9, 14: 0.3, 15: 0.8}


def _bolt_path(seed: int) -> list[tuple[int, int]]:
    rng = random.Random(seed)
    pts = []
    x = GROUND[0] + rng.randint(-10, 10)
    for i in range(13):
        y = int(GROUND[1] * i / 12)
        pts.append((x, y))
        x = GROUND[0] + int((x - GROUND[0]) * 0.6) + rng.randint(-14, 14)
    pts[-1] = GROUND
    return pts


def _scale(color, k):
    return tuple(int(c * k) for c in color)


def frame(i: int) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    gx, gy = GROUND
    if 2 <= i <= 9:  # charge: growing ground glow
        k = (i - 1) / 9
        r = int(8 + 22 * k)
        g.ellipse([gx - r, gy - r // 3, gx + r, gy + r // 3], fill=_scale((70, 140, 255), k))
    if i in BOLT:
        k = BOLT[i]
        path = _bolt_path(7)
        g.line(path, fill=_scale((60, 110, 255), k), width=14)
        g.line(path, fill=_scale((150, 220, 255), k), width=6)
        g.line(path, fill=_scale((255, 255, 255), k), width=2)
        g.ellipse([gx - 26, gy - 9, gx + 26, gy + 9], fill=_scale((150, 220, 255), k))
    if 13 <= i <= 27:  # expanding ground ring
        t = (i - 13) / 14
        r = int(20 + 70 * t)
        g.ellipse([gx - r, gy - r // 3, gx + r, gy + r // 3], outline=_scale((120, 200, 255), 1 - t), width=3)
    if 16 <= i <= 27:  # afterglow
        k = 1 - (i - 16) / 12
        g.ellipse([gx - 16, gy - 6, gx + 16, gy + 6], fill=_scale((90, 160, 255), 0.6 * k))
    glow = glow.filter(ImageFilter.GaussianBlur(1.2))
    added = np.asarray(img, dtype=np.int32) + np.asarray(glow, dtype=np.int32)
    return Image.fromarray(np.minimum(added, 255).astype(np.uint8))


def write(path: Path) -> Path:
    frames = [frame(i) for i in range(28)]
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, disposal=1)
    return path


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("samples/synthetic-sky-strike.gif")
    print(write(out))
