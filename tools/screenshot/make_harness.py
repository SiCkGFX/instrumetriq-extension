#!/usr/bin/env python3
"""Generate a screenshottable copy of the popup. Nothing in extension/ changes.

The harness is GENERATED from extension/popup.html on every run rather than kept
as a hand-maintained clone. A copy would drift the moment the popup changed, and
screenshots taken from a drifted copy show a product that does not exist. This
way the only thing that is ours is the shim; every line of markup, CSS and JS in
the shot is the shipped file.

    python3 tools/screenshot/make_harness.py            # uses the live payload
    python3 tools/screenshot/make_harness.py --payload some.json

Writes to tools/screenshot/build/, which is gitignored.
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"
HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"

# Copied verbatim from extension/. Kept explicit so a new asset has to be added
# deliberately rather than a glob quietly pulling in something unshipped.
ASSETS = [
    "popup.css",
    "popup.js",
    "sparkline-core.js",
    "content.js",
    "extensionpay.js",
]

LIVE_PAYLOAD = Path("/var/www/instrumetriq-api/data/extension_payload_v2.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", default=str(LIVE_PAYLOAD),
                    help="payload JSON to seed the popup with")
    args = ap.parse_args()

    src_html = EXT / "popup.html"
    if not src_html.exists():
        sys.exit(f"missing {src_html}")

    payload_path = Path(args.payload)
    if not payload_path.exists():
        sys.exit(f"missing payload {payload_path}. Pass --payload with a copy.")
    payload = json.loads(payload_path.read_text())

    BUILD.mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        shutil.copy2(EXT / name, BUILD / name)
    icons = BUILD / "icons"
    icons.mkdir(exist_ok=True)
    for p in (EXT / "icons").glob("*"):
        # Icons only. The store screenshots living in that directory are not
        # part of the popup and must not be dragged in.
        if p.suffix.lower() in (".png", ".svg") and p.name.lower().startswith(("icon", "instrumetriq-logo")):
            shutil.copy2(p, icons / p.name)

    html = src_html.read_text(encoding="utf-8")

    # The shim must define `chrome` before ANY popup script runs, including
    # extensionpay.js, which is the first one loaded. Inject at the top of <body>
    # rather than next to popup.js.
    inject = (
        "<script>window.__PAYLOAD__ = "
        + json.dumps(payload, separators=(",", ":"))
        + ";</script>\n<script src=\"shim.js\"></script>\n"
    )
    marker = "<body>"
    if marker not in html:
        sys.exit("could not find <body> in popup.html")
    html = html.replace(marker, marker + "\n" + inject, 1)

    (BUILD / "harness.html").write_text(html, encoding="utf-8")
    shutil.copy2(HERE / "shim.js", BUILD / "shim.js")

    coins = len(payload.get("coins", []))
    print(f"  harness written: {BUILD / 'harness.html'}")
    print(f"  payload: {payload_path}  ({coins} coins, pushed_at {payload.get('pushed_at')})")
    print(f"  open with e.g. ?coin=BTC&theme=dark&panel=methodology")


if __name__ == "__main__":
    main()
