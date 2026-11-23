"""Draw a range guide for a template: how wide its parts read, at its reference
distance and at gameplay camera distances, plus annotated key frames, its
must-read cues and how each layer moves when an actor moves.

    python tools/range_guide.py fire-flame-jet
    python tools/range_guide.py fire-flame-jet fire-dragon-breath --out exports/guides
    python tools/range_guide.py my-spell.json --seed 3 --character-m 2.0

Writes <out>/<template id>-range-guide.png (the guide sheet), .md (the same
numbers as text) and .json (every measurement), to exports/range-guides/ by
default. The template's `readability` block (docs/template-format.md#readability)
sets the reference distance, the camera distances, the must-read cues and the
key frames; without it they come from the footprint and the beats.

Measured from the viewer's own rendering, drawn side-on with an orthographic
camera so pixels map to world units exactly, in a headless browser the same
way as tools/export_sprites.py. Sizes are in world units (1 unit = one
character height) and in metres for a character --character-m tall (1.8).
On-screen sizes assume a 1080p screen and a 60 degree vertical field of view.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
import textwrap
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT / "tools"))

import export_sprites  # noqa: E402
from export_sprites import EXPORTS, ExportError  # noqa: E402

SCREEN_H = 1080
VFOV_DEG = 60
CHARACTER_M = 1.8
BANDS = [  # web/js/engine/readability.js BANDS
    (1, "lost", "lost (under 1 px)", (150, 40, 40)),
    (3, "flicker", "flickers (1-3 px)", (190, 110, 30)),
    (8, "line", "thin line (3-8 px)", (170, 160, 40)),
    (math.inf, "shape", "reads as a shape (8+ px)", (50, 140, 70)),
]
TRACKING_LABEL = {  # web/js/engine/readability.js TRACKING
    "follow": "follows the actor",
    "trail": "emitter follows, particles stay in the world",
    "stay": "stays where it landed",
}


# ------------------------------------------------------------ maths (pure)

def screen_px(size: float, distance: float) -> float:
    """On-screen pixels of something `size` units across seen from `distance` units."""
    return size / (2 * distance * math.tan(math.radians(VFOV_DEG / 2))) * SCREEN_H


def band(px: float) -> tuple:
    return next(b for b in BANDS if px < b[0])


def reads_until(size: float | None, min_px: float = 3) -> float:
    """Furthest camera distance (units) at which `size` is still `min_px` on screen."""
    if not size:
        return 0.0
    return size / (2 * math.tan(math.radians(VFOV_DEG / 2))) * SCREEN_H / min_px


def features(m: dict) -> list[dict]:
    """The sizes the guide tabulates: the spell's envelope and core at the peak, the
    plume, and each must-read cue. Each {label, size (units), note}."""
    peak = m["peak"]
    st = {s["u"]: s for s in peak["stations"]}
    first, mid, last = st[min(st)], st[0.5], st[max(st)]
    out = [
        {"label": "Envelope at the hand", "size": first["envelope"], "note": f"whole visible body, {first['u']:.0%} of the way out"},
        {"label": "Envelope, halfway", "size": mid["envelope"], "note": "whole visible body"},
        {"label": "Envelope near the target", "size": last["envelope"], "note": f"{last['u']:.0%} of the way out"},
        {"label": "Hot core (median)", "size": peak["core"], "note": "near-white pixels, no bloom"},
    ]
    if peak.get("plume"):
        out.append({"label": "Plume at the target (width)", "size": peak["plume"]["w"], "note": "everything within reach of the target"})
        out.append({"label": "Plume at the target (height)", "size": peak["plume"]["h"], "note": ""})
    for c in m["cues"]:
        label = f"Must read: {c['cue']}" + (" (flat on the ground: check the top view)" if c.get("flat_on_ground") else "")
        out.append({"label": label, "size": c["size"], "note": f"{c['measure']} at {c['t_ms']} ms"})
    return out


def cue_active(cue: dict, t_ms: float) -> bool:
    """Whether a must-read cue has to read at this moment: inside its beat, or near its moment."""
    if cue.get("at_ms") is not None and abs(cue["at_ms"] - t_ms) <= 120:
        return True
    a, b = cue.get("window_ms") or [cue["t_ms"], cue["t_ms"]]
    return a <= t_ms <= b and cue.get("at_ms") is None


def distances(r: dict) -> list:
    """The reference distance, then the camera distances not within 15% of it."""
    ref = r["reference_distance"]
    return [ref] + [d for d in r["view_distances"] if abs(d - ref) > 0.15 * ref]


def fmt_u(v: float | None, character_m: float) -> str:
    if v is None:
        return "none"
    cm = v * character_m * 100
    return f"{v:.2f} u ({cm:.0f} cm)" if cm < 100 else f"{v:.2f} u ({cm / 100:.2f} m)"


# ------------------------------------------------------------ drawing

def _font(size: int, bold: bool = False):
    from PIL import ImageFont
    names = ["DejaVuSans-Bold.ttf", "arialbd.ttf"] if bold else ["DejaVuSans.ttf", "arial.ttf"]
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


BG = (18, 19, 24)
FG = (230, 232, 238)
DIM = (140, 145, 160)
ENV = (90, 210, 240)
CORE = (255, 255, 255)
PLUME = (240, 110, 200)


def _crop_box(m: dict) -> tuple[int, int, int, int]:
    g = m["geometry"]
    xs = [g["caster"][0] - 40, g["target"][0] + 50, g["hand"][0]]
    ys = [g["caster"][1] + 14, g["caster"][1] - g["ppu"] * 1.15]
    for f in m["frames"]:
        b = f.get("box")
        if b:
            xs += [b["x0"], b["x1"]]
            ys += [b["y0"], b["y1"]]
    pad = 24
    return (max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad),
            min(g["width"], int(max(xs)) + pad), min(g["height"], int(max(ys)) + pad))


def _figure(d, x: float, ground: float, ppu: float, color=(70, 74, 90)):
    """A 1-unit stand-in outline for scale: body capsule and head."""
    h = ppu
    head = h * 0.13
    d.ellipse([x - head, ground - h, x + head, ground - h + 2 * head], outline=color, width=2)
    w = h * 0.16
    d.rounded_rectangle([x - w, ground - h + 2 * head + 2, x + w, ground], radius=int(w), outline=color, width=2)


def _bracket(d, x: float, y0: float, y1: float, color, label: str, font, right: bool = True, tick: int = 6):
    d.line([x, y0, x, y1], fill=color, width=2)
    d.line([x - tick, y0, x + tick, y0], fill=color, width=2)
    d.line([x - tick, y1, x + tick, y1], fill=color, width=2)
    if label:
        tx = x + tick + 3 if right else x - tick - 3 - d.textlength(label, font=font)
        d.text((tx, (y0 + y1) / 2 - 7), label, fill=color, font=font)


def annotate_frame(img, m: dict, frame: dict, crop, character_m: float, *, cues: list | None = None, scale: float = 1.0):
    """Draw scale figures, a ruler, station brackets and the plume box on a frame image (cropped)."""
    from PIL import ImageDraw
    g = m["geometry"]
    ppu = g["ppu"]
    cx, cy = crop[0], crop[1]
    im = img.crop(crop).convert("RGB")
    if scale != 1.0:
        im = im.resize((int(im.width * scale), int(im.height * scale)))
    d = ImageDraw.Draw(im)
    f = _font(13)
    P = lambda x, y: ((x - cx) * scale, (y - cy) * scale)  # noqa: E731
    ground = P(0, g["caster"][1])[1]
    d.line([0, ground, im.width, ground], fill=(55, 58, 70), width=1)
    _figure(d, P(g["caster"][0], 0)[0], ground, ppu * scale)
    _figure(d, P(g["target"][0], 0)[0], ground, ppu * scale)
    # Ruler: every unit from the caster.
    x0 = P(g["caster"][0], 0)[0]
    dist = g["target_distance"] or 1
    for k in range(0, int(dist) + 2):
        x = x0 + k * ppu * scale
        if x > im.width - 4:
            break
        d.line([x, ground, x, ground + 7], fill=DIM, width=1)
        d.text((x + 2, ground + 4), f"{k} u", fill=DIM, font=f)
    for s, gs in zip(frame["stations"], g["stations"]):
        x = P(gs["px"], 0)[0]
        if s.get("envelope_px"):
            a, b = s["envelope_px"]
            _bracket(d, x, P(0, a)[1], P(0, b + 1)[1], ENV, f"{s['envelope']:.2f}" if scale >= 0.8 else "", f, right=False)
        if s.get("core_px"):
            a, b = s["core_px"]
            ya, yb = P(0, a)[1], P(0, b + 1)[1]
            mid = (ya + yb) / 2
            d.line([x + 3, ya, x + 3, yb], fill=CORE, width=2)
            if scale >= 0.8:
                d.text((x + 8, mid - 22), f"core {s['core']:.3f}", fill=CORE, font=f)
    p = frame.get("plume")
    if p:
        a = P(p["x0"], p["y0"])
        b = P(p["x1"] + 1, p["y1"] + 1)
        for i in range(int(a[0]), int(b[0]), 10):  # dashed box
            d.line([i, a[1], min(i + 5, b[0]), a[1]], fill=PLUME, width=2)
            d.line([i, b[1], min(i + 5, b[0]), b[1]], fill=PLUME, width=2)
        for i in range(int(a[1]), int(b[1]), 10):
            d.line([a[0], i, a[0], min(i + 5, b[1])], fill=PLUME, width=2)
            d.line([b[0], i, b[0], min(i + 5, b[1])], fill=PLUME, width=2)
        d.text((a[0] + 3, a[1] - 17), f"plume {p['w']:.2f} x {p['h']:.2f} u", fill=PLUME, font=f)
    return im


def compose(m: dict, images: dict, character_m: float = CHARACTER_M):
    """The guide sheet as a PIL image. `images` maps image names to PIL images."""
    from PIL import Image, ImageDraw
    r = m["readability"]
    crop = _crop_box(m)
    W = 1500
    pad = 28
    title, h1, body, small = _font(30, True), _font(20, True), _font(15), _font(13)
    blocks = []  # (image, gap after)

    def text_block(lines: list[tuple[str, object, tuple]], width=W):
        hgt = sum((fnt.size + 8) for _, fnt, _ in lines) + 10
        im = Image.new("RGB", (width, hgt), BG)
        d = ImageDraw.Draw(im)
        y = 4
        for txt, fnt, col in lines:
            d.text((pad, y), txt, fill=col, font=fnt)
            y += fnt.size + 8
        return im

    def wrap(txt: str, n=150):
        return textwrap.wrap(txt, n) or [""]

    ref = r["reference_distance"]
    head = [
        (f"{m['template']['name']}  -  range guide", title, FG),
        (f"{m['template']['id']} · seed {m['seed']} · {m['style']} style · {m['template']['duration_ms']} ms", body, DIM),
        (f"Sizes in world units (u): 1 u = one character height, shown in metres for a {character_m} m character. "
         f"Reference distance {ref} u (~{ref * character_m:.1f} m, from {r['reference_source']}); "
         f"caster to target {m['geometry']['target_distance']} u.", body, FG),
        ("On-screen sizes: 1080p, 60° vertical field of view, side-on (the best case: front views foreshorten the jet).", body, DIM),
    ]
    blocks.append(text_block(head))

    # A: the peak frame, measured.
    peak = m["peak"]
    blocks.append(text_block([(f"Widths at the peak ({peak['t_ms']} ms), side-on", h1, FG),
                              ("Cyan: whole visible body across the cast direction.  White: the hot core.  Pink: the plume round the target.  "
                               "Grey outlines: 1 u stand-ins for scale.", small, DIM)]))
    scale = min(1.0, (W - 2 * pad) / max(1, crop[2] - crop[0]))
    peak_im = annotate_frame(images["peak"], m, peak, crop, character_m, scale=scale)
    row = Image.new("RGB", (W, peak_im.height + 10), BG)
    row.paste(peak_im, (pad, 0))
    blocks.append(row)

    # B: on-screen sizes at each distance.
    dists = distances(r)
    feats = features(m)
    col0, colw = 430, 140
    rh = 26
    tbl = Image.new("RGB", (W, 60 + rh * (len(feats) + 1) + 70), BG)
    d = ImageDraw.Draw(tbl)
    d.text((pad, 4), "On-screen size by camera distance (px on a 1080p screen)", fill=FG, font=h1)
    y = 40
    d.text((pad, y), "Feature (size)", fill=DIM, font=small)
    for i, dist in enumerate(dists):
        lab = f"{dist} u (~{dist * character_m:.0f} m){' ref' if dist == ref else ''}"
        d.text((pad + col0 + i * colw, y), lab, fill=DIM, font=small)
    d.text((pad + col0 + len(dists) * colw, y), "3 px until", fill=DIM, font=small)
    y += rh
    for ft in feats:
        d.text((pad, y + 4), f"{ft['label']}: {fmt_u(ft['size'], character_m)}", fill=FG, font=small)
        for i, dist in enumerate(dists):
            x = pad + col0 + i * colw
            if ft["size"]:
                px = screen_px(ft["size"], dist)
                b = band(px)
                d.rectangle([x, y + 1, x + colw - 8, y + rh - 3], fill=b[3])
                d.text((x + 6, y + 4), f"{px:.1f} px", fill=FG, font=small)
            else:
                d.text((x + 6, y + 4), "not seen", fill=DIM, font=small)
        until = reads_until(ft["size"])
        d.text((pad + col0 + len(dists) * colw, y + 4), f"{until:.1f} u (~{until * character_m:.0f} m)" if until else "-", fill=FG, font=small)
        y += rh
    y += 8
    x = pad
    for _, _, label, col in BANDS:
        d.rectangle([x, y, x + 14, y + 14], fill=col)
        d.text((x + 20, y), label, fill=DIM, font=small)
        x += 40 + d.textlength(label, font=small)
    blocks.append(tbl)

    # C: how the peak looks from each distance.
    blocks.append(text_block([("How the peak reads from each distance", h1, FG),
                              ("Top: true pixel size on a 1080p screen (1:1).  Bottom: the same pixels enlarged to compare.", small, DIM)]))
    thumbs = []
    for dist in dists:
        key = f"distance-{dist}"
        if key not in images:
            continue
        im = images[key]
        k = m["images"][key]["ppu"] / m["geometry"]["ppu"]
        c = (int(crop[0] * k), int(crop[1] * k), max(int(crop[0] * k) + 2, int(crop[2] * k)), max(int(crop[1] * k) + 2, int(crop[3] * k)))
        thumbs.append((dist, im.crop(c).convert("RGB")))
    if thumbs:
        gap = 16
        zw = (W - 2 * pad - gap * (len(thumbs) - 1)) // len(thumbs)
        true_h = max(t.height for _, t in thumbs if t.width <= zw) if any(t.width <= zw for _, t in thumbs) else 0
        zoom = [t.resize((zw, max(1, int(t.height * zw / t.width))), Image.NEAREST) for _, t in thumbs]
        zh = max(z.height for z in zoom)
        strip = Image.new("RGB", (W, true_h + zh + 60), BG)
        d = ImageDraw.Draw(strip)
        for i, ((dist, t), z) in enumerate(zip(thumbs, zoom)):
            x = pad + i * (zw + gap)
            d.text((x, 2), f"{dist} u (~{dist * character_m:.0f} m)", fill=FG, font=small)
            if t.width <= zw:
                strip.paste(t, (x, 22))
            else:
                d.text((x, 22), f"(1:1 is {t.width} px wide)", fill=DIM, font=small)
            strip.paste(z, (x, 22 + true_h + 10))
        blocks.append(strip)

    # D: key frames.
    blocks.append(text_block([("Key frames (the quality target)", h1, FG)]))
    kscale = min(0.62, (W - 2 * pad) / 2 / max(1, crop[2] - crop[0]))
    for i, k in enumerate(m["key_frames"]):
        im = annotate_frame(images[f"key-{i}"], m, k["measured"], crop, character_m, scale=kscale)
        tx = pad + im.width + 20
        lines = [(f"{k['label']}  ·  {k['t_ms']} ms" + ("" if k.get("source") == "template" else "  (from the beats)"), h1, FG)]
        lines += [(ln, body, FG) for ln in wrap(k.get("note") or "", max(30, int((W - tx - pad) / 8.2)))]
        mm = k["measured"]
        lines.append((f"Body (median) {fmt_u(mm['envelope'], character_m)} · core {fmt_u(mm['core'], character_m)}"
                      + (f" · plume {mm['plume']['w']:.2f} x {mm['plume']['h']:.2f} u" if mm.get("plume") else ""), small, ENV))
        active = [c for c in m["cues"] if cue_active(c, k["t_ms"])]
        for c in active:
            lines.append((f"Must read here: {c['cue']}", small, (250, 210, 120)))
        hgt = max(im.height, sum(f.size + 8 for _, f, _ in lines)) + 16
        rowim = Image.new("RGB", (W, hgt), BG)
        rowim.paste(im, (pad, 0))
        d = ImageDraw.Draw(rowim)
        y = 2
        for txt, fnt, col in lines:
            d.text((tx, y), txt, fill=col, font=fnt)
            y += fnt.size + 8
        blocks.append(rowim)

    # E: must-read cues and tracking.
    lines = [("Must-read cues", h1, FG)]
    if m["cues"]:
        for c in m["cues"]:
            px = [f"{screen_px(c['size'], dd):.1f}" for dd in dists] if c["size"] else ["-"] * len(dists)
            lines.append((f"• {c['cue']}  ({', '.join(c['layers'])}; {c['measure']} {fmt_u(c['size'], character_m)}; "
                          f"px at {', '.join(str(x) for x in dists)} u: {' / '.join(px)})", body, (250, 210, 120)))
            for ln in wrap(c.get("why") or "", 160):
                lines.append(("   " + ln, small, DIM))
    else:
        lines.append(("None in the template yet (readability.must_read).", body, DIM))
    lines.append(("", small, DIM))
    lines.append(("When an actor moves (layers[].tracking)", h1, FG))
    for kind in ("follow", "trail", "stay"):
        ids = [f"{l['id']}{'' if l['tracking_source'] == 'template' else '*'}" for l in m["layers"] if l["tracking"] == kind]
        if ids:
            lines.append((f"{TRACKING_LABEL[kind]}: {', '.join(ids)}", body, FG))
    if any(l["tracking_source"] != "template" for l in m["layers"] if l["tracking"]):
        lines.append(("* default for the layer type; the template doesn't say.", small, DIM))
    blocks.append(text_block(lines))

    H = sum(b.height for b in blocks) + pad * 2
    sheet = Image.new("RGB", (W, H), BG)
    y = pad
    for b in blocks:
        sheet.paste(b, (0, y))
        y += b.height
    return sheet


def markdown(m: dict, character_m: float = CHARACTER_M) -> str:
    r = m["readability"]
    ref = r["reference_distance"]
    dists = distances(r)
    out = [f"# {m['template']['name']}: range guide", "",
           f"`{m['template']['id']}`, seed {m['seed']}, {m['style']} style. 1 u = one character height (~{character_m} m). "
           f"Reference distance {ref} u (from {r['reference_source']}). On-screen sizes: 1080p, 60° vertical FOV, side-on.", "",
           f"## Sizes at the peak ({m['peak']['t_ms']} ms)", "",
           "| Feature | Size | " + " | ".join(f"{d} u{' (ref)' if d == ref else ''}" for d in dists) + " | Reads (3 px) until |",
           "|---|---|" + "---|" * len(dists) + "---|"]
    for ft in features(m):
        cells = [f"{screen_px(ft['size'], d):.1f} px, {band(screen_px(ft['size'], d))[1]}" if ft["size"] else "not seen" for d in dists]
        until = reads_until(ft["size"])
        out.append(f"| {ft['label']} | {fmt_u(ft['size'], character_m)} | " + " | ".join(cells) + f" | {until:.1f} u |")
    out += ["", "## Key frames", ""]
    for k in m["key_frames"]:
        mm = k["measured"]
        out.append(f"- **{k['label']}** ({k['t_ms']} ms{'' if k.get('source') == 'template' else ', from the beats'}): {k.get('note') or ''} "
                   f"Body {fmt_u(mm['envelope'], character_m)}, core {fmt_u(mm['core'], character_m)}"
                   + (f", plume {mm['plume']['w']:.2f} × {mm['plume']['h']:.2f} u." if mm.get("plume") else "."))
    out += ["", "## Must-read cues", ""]
    for c in m["cues"] or []:
        out.append(f"- **{c['cue']}** ({', '.join(c['layers'])}): {c['measure']} {fmt_u(c['size'], character_m)} at {c['t_ms']} ms. {c.get('why') or ''}")
    if not m["cues"]:
        out.append("- None in the template yet (`readability.must_read`).")
    out += ["", "## When an actor moves", ""]
    for l in m["layers"]:
        if l["tracking"]:
            out.append(f"- `{l['id']}` ({l['type']} at {l['anchor']}): {TRACKING_LABEL[l['tracking']]}{'' if l['tracking_source'] == 'template' else ' (default)'}")
    return "\n".join(out) + "\n"


# ------------------------------------------------------------ running

def guide(template: str | dict, *, seed: int = 1, style: str | None = None, out: Path | str | None = None,
          character_m: float = CHARACTER_M, ppu: int = 160, timeout_s: float = 900) -> dict:
    """Measure a template and write its range guide. Returns {"files": [...], "manifest": {...}}."""
    from PIL import Image
    opts = {"kind": "range_guide", "seed": seed, "ppu": ppu}
    if style:
        opts["style"] = style
    result = export_sprites.run_in_page(template, opts, timeout_s)
    m = result["manifest"]
    images = {Path(f["name"]).stem: Image.open(io.BytesIO(base64.b64decode(f["base64"]))) for f in result["files"]}
    folder = Path(out) if out else EXPORTS / "range-guides"
    folder.mkdir(parents=True, exist_ok=True)
    base = folder / f"{m['template']['id']}-range-guide"
    sheet = compose(m, images, character_m)
    sheet.save(base.with_suffix(".png"))
    base.with_suffix(".md").write_text(markdown(m, character_m), encoding="utf-8")
    base.with_suffix(".json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    return {"files": [str(base.with_suffix(s)) for s in (".png", ".md", ".json")], "manifest": m}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("templates", nargs="+", help="template ids (e.g. fire-flame-jet) or paths to template .json files")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--style", choices=export_sprites.STYLES)
    ap.add_argument("--character-m", type=float, default=CHARACTER_M, help="character height in metres for the metre read-outs (1.8)")
    ap.add_argument("--ppu", type=int, default=160, help="measuring resolution, pixels per unit (160)")
    ap.add_argument("--out", help="output folder (default exports/range-guides)")
    args = ap.parse_args(argv)
    status = 0
    for t in args.templates:
        try:
            res = guide(t, seed=args.seed, style=args.style, out=args.out, character_m=args.character_m, ppu=args.ppu)
        except ExportError as exc:
            print(f"error: {t}: {exc}", file=sys.stderr)
            status = 1
            continue
        for f in res["files"]:
            print(f)
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
