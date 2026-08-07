# Store screenshots

Generates the listing images from the real popup, without wiring test code into
the shipped extension.

## How it avoids lying

Two rules the whole thing is built around.

**The popup is never cloned.** `make_harness.py` reads `extension/popup.html` on
every run and injects a shim into a generated copy. That copy then loads the real
`popup.js`, `popup.css`, `sparkline-core.js` and `content.js`. A hand-maintained
duplicate would drift the first time the card changed, and the screenshots would
show a product that does not exist.

**The numbers are never invented.** A store shot usually wants a coin in a
particular state, and those states are common but not on demand. `as_of.py`
rewinds instead: it copies the per-coin CSVs, drops every row after a chosen
cycle, and runs the REAL builder against the copy. Every figure on the card was
measured at the timestamp shown. The shim also holds the clock at that moment, so
"8 min ago" is what a user actually saw then. The clock is shifted; no value is.

## One-time setup

A browser is the only requirement.

    # Chrome for Testing: standalone, no root, no snap
    curl -sL "$(python3 - <<'PY'
import json,urllib.request
d=json.load(urllib.request.urlopen("https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"))
print([x["url"] for x in d["channels"]["Stable"]["downloads"]["chrome"] if x["platform"]=="linux64"][0])
PY
)" -o /tmp/cft.zip
    unzip -q /tmp/cft.zip -d tools/screenshot/chrome
    chmod +x tools/screenshot/chrome/chrome-linux64/chrome

Do NOT use `apt install chromium` on Ubuntu Noble. It is a snap shim that pulls
~1.5 GB of desktop graphics stack (gnome-46, mesa, gtk themes) onto a headless
box, and the result is AppArmor-confined so it cannot write a screenshot outside
its sandbox anyway.

**Fonts matter more than they look.** With no fonts installed, the popup's stack
(`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) falls all
the way through to DejaVu Sans, which is wider than any of them and makes every
capture look stretched. Install Roboto, which is in the stack and is what
Chrome-on-Linux users see:

    mkdir -p ~/.local/share/fonts
    curl -sS -A "Mozilla/5.0" \
      "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700" -o /tmp/r.css
    i=0; for u in $(grep -o "https://fonts.gstatic.com/[^)]*" /tmp/r.css | head -3); do
      i=$((i+1)); curl -sSL "$u" -o ~/.local/share/fonts/rb$i.ttf; done
    fc-cache -f

Check the magic bytes before trusting a downloaded font: GitHub raw returns HTML
error pages at the right sort of size, which install silently and render as
nothing. A real TTF starts `00010000`.

## Generating the set

    export CHROMIUM=$PWD/tools/screenshot/chrome/chrome-linux64/chrome
    python3 tools/screenshot/store_set.py      # captures raw-NN.png
    python3 tools/screenshot/compose.py --all  # composes to 1280x800

Output lands in `tools/screenshot/store/`, numbered to continue from the existing
listing images rather than overwrite them.

Which coin and which moment each shot uses is declared in `SHOTS` at the top of
`store_set.py`. Captions live in `CAPTIONS` in `compose.py`.

A shot with no entry in `CAPTIONS` is captured raw and not composed, which is how
the coin-detection image is produced: `raw-11.png` at 800x1200, to be framed over
a trading page by hand.

`detect=1` is what makes that shot work. It puts the coin on the "current page"
via the faked tab URL WITHOUT adding it to the tracked list, which is the only
way to trigger the teaser card. It also leaves one free slot, so the teaser
offers "Add X to your tracked coins" rather than the Go Pro variant that appears
once the free limit is reached.

## Ad-hoc shots

    python3 tools/screenshot/make_harness.py                 # live payload
    python3 tools/screenshot/shoot.py --list
    python3 tools/screenshot/shoot.py --only card --coin IMX

Harness scenarios come from the query string:

    ?coin=IMX&theme=light&panel=methodology&tf=week&pro=1&sort=attention

`panel` is one of onboarding, methodology, sites, privacy, picker. The shim
clicks the real control rather than un-hiding the panel, because the picker
builds its list in `openPicker()` and simply removing `.hidden` yields a
correctly styled but empty panel.

## Fonts, and why they matter here

The extension asks for `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
sans-serif`. That resolves to San Francisco on macOS, Segoe UI on Windows, and
Roboto on Chrome/Linux and Android. There is no single "the extension font"; it
is whatever the reader's OS supplies from that list.

Screenshots render in **Roboto**, the last named entry and the one Chrome
supplies on Linux. Caption text on the canvas uses the same Roboto so the panel
and the popup do not disagree typographically.

Verify what actually got used rather than assuming:

    fc-match Roboto
    python3 -c "import sys;sys.path.insert(0,'tools/screenshot');\
    import importlib.util;s=importlib.util.spec_from_file_location('c','tools/screenshot/compose.py');\
    m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.load_font(20,'bold').path)"

If either falls back to DejaVu Sans, the fonts are not installed and every
capture will look wider than the real product.

## Composition

Canvas is 1280x800, the Chrome Web Store size. The popup is captured at 2x and
downscaled by exactly half to 400x600, its TRUE size, so a reviewer sees it at
the scale they would actually get rather than an enlargement.

The remaining canvas carries the caption. Every colour comes from `popup.css`
and nothing else, so the surround cannot introduce a colour the product does not
use. Light shots switch to the light palette.

### Shots that need a page behind them

The detection shot has to show a coin page, or it makes no point. Rather than
composing it in a different style, which would break the set into two designs,
the page is confined to the right side, dimmed, and feathered into the caption
column so the left third stays the same solid panel as every other image.

    python3 tools/screenshot/compose.py --shot 11 --bg mypage.png --dim 0.62

`--dim` is 0 for the page at full strength and 1 for invisible. 0.62 keeps it
legible as a coin page without competing with the popup.

`backdrop.png` in this directory is the default for shot 11. It was cropped from
the previous listing image, taking only the region LEFT of where the old popup
sat: a naive crop of the light area pulls in the old overlay and its caption, and
they reappear ghosted behind the new one.

## Promo tiles

    python3 tools/screenshot/promo.py

Writes `promo-tile-small.png` (440x280) and `promo-tile-marquee.png` (1400x560)
into `store/`, the two sizes the Chrome Web Store asks for.

The wordmark is rendered from `extension/icons/instrumetriq-logo.svg` via cairosvg
rather than cropped out of the previous tile, so it stays sharp at any size.
Palette and fonts come from `compose.py`, so the tiles and the screenshots are one
family.

The readings shown are real and all come from ONE cycle, recorded as
`PROMO_SOURCE` in `promo.py`, so the tile is internally consistent rather than
stitched together from four different moments. Rebuild that payload with
`as_of.py PROMO_SOURCE` to re-verify the figures.

Pick recognisable coins. A tile is the first thing a stranger sees, and a mid-cap
they have never heard of gives them nothing to anchor on. Finding one cycle where
well-known coins span all four bands takes a scan of the post-guard history.
The band names are the current four. The tiles these replace still showed Spiking,
Buzzing, Active and Quiet, which have not existed since the v2 rebuild.

## Finding a coin in a given state

    python3 - <<'PY'
    import json
    p=json.load(open('/var/www/instrumetriq-api/data/extension_payload_v2.json'))
    def band(r): return 'Unusual' if r>=6 else 'Busy' if r>=1.5 else 'Steady' if r>=0.5 else 'Quiet'
    for c in p['coins']:
        a=c.get('attention') or {}; t=c.get('tone')
        if not t or a.get('ratio') is None or a.get('silent'): continue
        print(c['symbol'], band(a['ratio']), a['ratio'], f"{t['pos']}/{t['neg']}")
    PY

If nothing matches today, scan the CSVs for a past cycle that did and pass that
timestamp to `as_of.py`. Both the states used in the current set were found that
way.

## Verify by looking

Every defect this harness has produced was invisible to exit codes and file
sizes: a card for a coin with no data, an empty picker panel, two chart labels
printed on top of each other. All returned success at a plausible size. Open the
PNGs.
