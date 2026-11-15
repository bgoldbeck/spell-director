"""Draw a small synthetic sky-strike GIF with a known timeline.

Used by the tests and handy for trying the breakdown tool without a real GIF:
    python tools/sample_gif.py samples/synthetic-sky-strike.gif
    python tools/breakdown.py samples/synthetic-sky-strike.gif

A path ending in .mp4 writes the same timeline as an H.264 video (needs PyAV):
    python tools/sample_gif.py samples/synthetic-sky-strike.mp4

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


def write_video(path: Path, fps: int = 1000 // FRAME_MS, lead_in: int = 0) -> Path:
    """Write the timeline as a video. fps must be a multiple of 25 (the GIF's
    rate); higher rates repeat frames. lead_in adds that many empty GIF frames
    before the timeline (for testing --start)."""
    import av

    repeat = fps // (1000 // FRAME_MS)
    if repeat < 1 or fps % (1000 // FRAME_MS):
        raise ValueError("fps must be a multiple of 25")
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = [frame(0)] * lead_in + [frame(i) for i in range(28)]
    with av.open(str(path), mode="w") as out:
        stream = out.add_stream("libx264" if "libx264" in av.codecs_available else "mpeg4", rate=fps)
        stream.width, stream.height, stream.pix_fmt = W, H, "yuv420p"
        stream.options = {"crf": "12"} if stream.codec_context.name == "libx264" else {}
        for img in frames:
            for _ in range(repeat):
                for packet in stream.encode(av.VideoFrame.from_image(img)):
                    out.mux(packet)
        for packet in stream.encode():
            out.mux(packet)
    return path


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("samples/synthetic-sky-strike.gif")
    print(write_video(out) if out.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"} else write(out))
