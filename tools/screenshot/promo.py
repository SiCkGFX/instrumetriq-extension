#!/usr/bin/env python3
"""Chrome Web Store promo tiles, in the same visual language as the screenshots.

    python3 tools/screenshot/promo.py

Writes promo-tile-small.png (440x280) and promo-tile-marquee.png (1400x560) into
tools/screenshot/store/, beside the numbered screenshots.

Palette comes from popup.css and nothing else, same as compose.py. The wordmark is
rendered from the real SVG rather than cropped out of the previous tile, so it
stays sharp at any size.

The band names shown are the CURRENT four (Quiet, Steady, Busy, Unusual). The
tiles being replaced still showed Spiking, Buzzing, Active and Quiet, which have
not existed since the v2 rebuild.
"""

import io
from pathlib import Path

try:
    import cairosvg
except ImportError:
    raise SystemExit("cairosvg missing: pip install cairosvg")
from PIL import Image, ImageDraw

import importlib.util

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "store"
LOGO = ROOT / "extension/icons/instrumetriq-logo.svg"

_spec = importlib.util.spec_from_file_location("cmp", HERE / "compose.py")
_c = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_c)
PAL, load_font = _c.DARK, _c.load_font

# The cycle every displayed reading comes from. Kept as a constant so the numbers
# can be re-verified against a rebuilt payload:
#   python3 tools/screenshot/as_of.py 2026-08-03T19:16Z --out /tmp/p.json
PROMO_SOURCE = "2026-08-03T19:16Z"

# Real bands, in order, with the colour each actually renders in the popup.
BANDS = [
    ("UNUSUAL", "amber"),
    ("BUSY",    "cyan"),
    ("STEADY",  "second"),
    ("QUIET",   "muted"),
]


def logo(width):
    png = cairosvg.svg2png(url=str(LOGO), output_width=width * 3)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    im = im.crop(im.getbbox())
    h = round(im.height * width / im.width)
    return im.resize((width, h), Image.LANCZOS)


def band_row(d, x, y, w, h, name, colour, coin, value):
    d.rounded_rectangle([x, y, x + w, y + h], radius=6, fill=PAL["card"])
    f_coin = load_font(round(h * 0.42), "medium")
    f_band = load_font(round(h * 0.34), "bold")
    f_val = load_font(round(h * 0.34), "regular")
    d.text((x + 18, y + h / 2), coin, font=f_coin, fill=PAL["text"], anchor="lm")
    tw = d.textlength(name, font=f_band)
    d.text((x + w - 18, y + h / 2), name, font=f_band, fill=PAL[colour], anchor="rm")
    d.text((x + w - 30 - tw, y + h / 2), value, font=f_val, fill=PAL["second"], anchor="rm")


def small():
    W, H = 440, 280
    im = Image.new("RGB", (W, H), PAL["bg"])
    d = ImageDraw.Draw(im)
    lg = logo(268)
    im.paste(lg, ((W - lg.width) // 2, 26), lg)

    f = load_font(15, "regular")
    d.text((W / 2, 26 + lg.height + 20), "Who the crowd is talking about",
           font=f, fill=PAL["second"], anchor="mm")

    # Real readings, all from ONE moment (2026-08-03T19:16Z) so the tile is
    # internally consistent, and from recognisable coins so a stranger can anchor
    # on the names. Nothing here is invented; see PROMO_SOURCE below.
    rows = [("UNUSUAL", "amber", "TON", "8.5x"), ("BUSY", "cyan", "PEPE", "2.2x"),
            ("STEADY", "second", "XRP", "1.2x")]
    y = 132
    for name, col, coin, val in rows:
        band_row(d, 34, y, W - 68, 40, name, col, coin, val)
        y += 47
    return im, "promo-tile-small.png"


def marquee():
    W, H = 1400, 560
    im = Image.new("RGB", (W, H), PAL["bg"])
    d = ImageDraw.Draw(im)

    lg = logo(560)
    im.paste(lg, (72, 62), lg)

    f_lead = load_font(30, "regular")
    f_sub = load_font(20, "regular")
    y = 62 + lg.height + 34
    d.text((72, y), "See which coins are suddenly", font=f_lead, fill=PAL["text"])
    d.text((72, y + 40), "drawing unusual conversation", font=f_lead, fill=PAL["text"])
    d.rectangle([72, y + 92, 72 + 54, y + 95], fill=PAL["cyan"])
    d.text((72, y + 118),
           "Measured against each coin's own normal, so a small",
           font=f_sub, fill=PAL["second"])
    d.text((72, y + 148),
           "coin waking up counts for as much as a large one.",
           font=f_sub, fill=PAL["second"])

    # Band ladder on the right, all four states in their real popup colours.
    # Same moment and same source as small(). See PROMO_SOURCE.
    rows = [("UNUSUAL", "amber", "TON", "8.5x usual"),
            ("BUSY", "cyan", "PEPE", "2.2x usual"),
            ("STEADY", "second", "XRP", "1.2x usual"),
            ("QUIET", "muted", "TIA", "0.4x usual")]
    x, w, rh = 770, 560, 74
    y = (H - (len(rows) * rh + (len(rows) - 1) * 16)) // 2
    for name, col, coin, val in rows:
        band_row(d, x, y, w, rh, name, col, coin, val)
        y += rh + 16

    d.text((72, H - 52), "Social conversation only. Not a trading signal.",
           font=load_font(16, "regular"), fill=PAL["muted"])
    return im, "promo-tile-marquee.png"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (small, marquee):
        im, name = fn()
        p = OUT / name
        im.save(p, "PNG", optimize=True)
        print(f"  {name:<26} {im.size[0]}x{im.size[1]}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
