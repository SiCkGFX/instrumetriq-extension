#!/usr/bin/env python3
"""Compose a popup capture onto a 1280x800 store canvas with a caption panel.

    python3 tools/screenshot/compose.py --shot 07 --title "..." --body "..."
    python3 tools/screenshot/compose.py --all

1280x800 is the Chrome Web Store size and matches the existing listing images.

The popup is placed at its TRUE size, 400x600 CSS pixels. It is captured at 2x
(800x1200) and downscaled by exactly half, so what a reviewer sees is the real
thing at the real scale rather than an enlargement. That leaves the rest of the
canvas for a caption.

Palette is taken from popup.css and nothing else, so the surround cannot
introduce a colour the product does not use.
"""

import argparse
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    raise SystemExit("Pillow missing: pip install Pillow")

HERE = Path(__file__).resolve().parent
OUT = HERE / "store"

CANVAS = (1280, 800)
POPUP = (400, 600)          # the popup's real size, not a scaled-up version

# Straight from popup.css :root
DARK = {
    "bg":     (0x14, 0x14, 0x14),
    "card":   (0x1E, 0x1E, 0x1E),
    "text":   (0xE8, 0xE8, 0xE8),
    "second": (0x70, 0x70, 0x70),
    "muted":  (0x50, 0x50, 0x50),
    "cyan":   (0x00, 0xBC, 0xD4),
    "amber":  (0xFF, 0xB7, 0x4D),
    "border": (0x2A, 0x2A, 0x2A),
}
LIGHT = {
    "bg":     (0xF5, 0xF5, 0xF5),
    "card":   (0xFF, 0xFF, 0xFF),
    "text":   (0x1A, 0x1A, 0x1A),
    "second": (0x5A, 0x5A, 0x5A),
    "muted":  (0x99, 0x99, 0x99),
    "cyan":   (0x00, 0x97, 0xA7),
    "amber":  (0xE6, 0x92, 0x0D),
    "border": (0xD5, 0xD5, 0xD5),
}

FONTS = [
    Path.home() / ".local/share/fonts",
    Path("/usr/share/fonts"),
]

# Shots that need a page behind them to make their point.
DEFAULT_BG = {"11": str(HERE / "backdrop.png")}

CAPTIONS = {
    "07": ("Unusual attention",
           "When a coin draws far more posting accounts than its own normal, "
           "it is flagged and colour-coded. Everything below the chart covers "
           "the same 24 hours.",
           "amber"),
    "08": ("Tone, not direction",
           "The split of positive, neutral and negative language across a day, "
           "with a separate reading of how consistent the scoring was.",
           "cyan"),
    "09": ("Light or dark",
           "The same card in the light theme. Follows your system by default.",
           "amber"),
    "10": ("Track what you want",
           "Search or sort the full universe by how busy each coin is right now. "
           "Free tracks two coins, Pro tracks all of them.",
           "cyan"),
    "11": ("Opens on the coin you are viewing",
           "Land on a coin page and the popup is already on it. Twenty-three "
           "exchanges and data sites, detected from the address alone.",
           "cyan"),
}


def load_font(size, weight="regular"):
    names = {"regular": ["rb1.ttf", "Roboto-Regular.ttf", "DejaVuSans.ttf"],
             "medium":  ["rb2.ttf", "Roboto-Medium.ttf", "DejaVuSans-Bold.ttf"],
             "bold":    ["rb3.ttf", "Roboto-Bold.ttf", "DejaVuSans-Bold.ttf"]}[weight]
    for root in FONTS:
        for n in names:
            for p in root.rglob(n):
                try:
                    return ImageFont.truetype(str(p), size)
                except Exception:
                    pass
    return ImageFont.load_default()


def wrap(draw, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def compose(shot_png, dest, title, body, accent="cyan", light=False, bg=None, dim=0.62):
    pal = LIGHT if light else DARK
    popup = Image.open(shot_png).convert("RGBA")
    # Exactly half of the 2x capture: true size, no enlargement.
    popup = popup.resize(POPUP, Image.LANCZOS)

    canvas = Image.new("RGB", CANVAS, pal["bg"])

    # Popup sits right of centre, caption gets the left third. Generous margins
    # rather than filling the space, which is what makes it read as deliberate.
    px = 720
    py = (CANVAS[1] - POPUP[1]) // 2

    # Optional page behind the popup, for the shot that has to SHOW context
    # (detection). Confined to the right side and dimmed, so the caption column
    # stays the same solid panel as every other image in the set and the two read
    # as one family rather than two designs.
    if bg and Path(bg).exists():
        band_x = 560
        page = Image.open(bg).convert("RGB")
        bw = CANVAS[0] - band_x
        scale = max(bw / page.width, CANVAS[1] / page.height)
        page = page.resize((round(page.width * scale), round(page.height * scale)), Image.LANCZOS)
        page = page.crop((0, 0, bw, CANVAS[1]))
        # Higher dim pushes the page further back. 0.62 keeps it legible as a
        # coin page without competing with the popup for attention.
        page = Image.blend(page, Image.new("RGB", page.size, pal["bg"]), dim)
        canvas.paste(page, (band_x, 0))
        # Feather the inner edge so the page fades into the caption column rather
        # than butting against it with a hard seam.
        FEATHER = 160
        mask = Image.new("L", (FEATHER, 1))
        for x in range(FEATHER):
            mask.putpixel((x, 0), int(255 * (1 - x / FEATHER)))
        mask = mask.resize((FEATHER, CANVAS[1]))
        canvas.paste(Image.new("RGB", (FEATHER, CANVAS[1]), pal["bg"]), (band_x, 0), mask)

    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle(
        [px + 4, py + 8, px + POPUP[0] + 4, py + POPUP[1] + 8],
        fill=(0, 0, 0, 130 if not light else 60))
    canvas = Image.alpha_composite(
        canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(16))).convert("RGB")
    canvas.paste(popup, (px, py), popup)

    d = ImageDraw.Draw(canvas)
    lx, lw = 110, 500

    f_kicker = load_font(13, "medium")
    f_title = load_font(40, "bold")
    f_body = load_font(17, "regular")
    f_foot = load_font(13, "regular")

    y = py + 40
    d.text((lx, y), "INSTRUMETRIQ", font=f_kicker, fill=pal[accent])
    y += 34

    for line in wrap(d, title, f_title, lw):
        d.text((lx, y), line, font=f_title, fill=pal["text"])
        y += 50
    y += 14

    # A short accent rule, the only decoration.
    d.rectangle([lx, y, lx + 46, y + 2], fill=pal[accent])
    y += 30

    for line in wrap(d, body, f_body, lw):
        d.text((lx, y), line, font=f_body, fill=pal["second"])
        y += 28

    d.text((lx, py + POPUP[1] - 18), "Social conversation only. Not a trading signal.",
           font=f_foot, fill=pal["muted"])

    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG", optimize=True)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--title", default="")
    ap.add_argument("--body", default="")
    ap.add_argument("--accent", default="cyan", choices=["cyan", "amber"])
    ap.add_argument("--light", action="store_true")
    ap.add_argument("--bg", default="", help="page screenshot to sit behind the popup")
    ap.add_argument("--dim", type=float, default=0.62, help="0=page at full strength, 1=invisible")
    args = ap.parse_args()

    nums = sorted(CAPTIONS) if args.all else ([args.shot] if args.shot else [])
    if not nums:
        raise SystemExit("--shot NN or --all")

    for n in nums:
        src = OUT / f"raw-{n}.png"
        if not src.exists():
            print(f"  MISSING {src}")
            continue
        title, body, accent = CAPTIONS.get(n, (args.title, args.body, args.accent))
        if args.title:
            title, body, accent = args.title, args.body, args.accent
        light = args.light or n == "09"
        dest = compose(src, OUT / f"Screenshot Instrumetriq extension {n}.png",
                       title, body, accent, light, args.bg or DEFAULT_BG.get(n), args.dim)
        w, h = Image.open(dest).size
        print(f"  {n}  {w}x{h}  {'light' if light else 'dark'}  {title}")


if __name__ == "__main__":
    main()
